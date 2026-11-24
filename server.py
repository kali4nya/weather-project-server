from flask import Flask, request, jsonify, render_template

import sqlite3
from datetime import datetime, timezone
import logging
import time

app = Flask(__name__)

# Hide Flask request logs
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

DATABASE = "/raid/data/db/weather-project/sensor_data.db"


# ------------------------
# Database Helper
# ------------------------


def get_db():

    conn = sqlite3.connect(DATABASE, timeout=10)

    conn.row_factory = sqlite3.Row

    # Allow reading while writing
    conn.execute("PRAGMA journal_mode=WAL;")

    # Good balance between speed and safety
    conn.execute("PRAGMA synchronous=NORMAL;")

    return conn


def init_db():

    with get_db() as conn:

        cursor = conn.cursor()

        # Create table if it doesn't exist
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS measurements (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                sensor_id TEXT NOT NULL,

                timestamp TEXT NOT NULL,

                temperature REAL,

                humidity REAL,

                pressure REAL

            )
            """
        )

        # ------------------------------------------------
        # Database migration
        #
        # Your existing database probably already has
        # temperature and humidity but no pressure column.
        # ------------------------------------------------

        cursor.execute("PRAGMA table_info(measurements)")

        columns = [row["name"] for row in cursor.fetchall()]

        if "pressure" not in columns:

            print("Adding pressure column to database...")

            cursor.execute(
                """
                ALTER TABLE measurements
                ADD COLUMN pressure REAL
                """
            )

            print("Pressure column added.")

        # Indexes
        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sensor_time
            ON measurements(sensor_id, timestamp)
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_timestamp
            ON measurements(timestamp)
            """
        )

        conn.commit()


# ------------------------
# Receive ESP32 data
# ------------------------


@app.route("/sensor", methods=["POST"])
def sensor():

    data = request.get_json(silent=True)

    if not data:

        return jsonify({"error": "No JSON received"}), 400

    sensor_id = data.get("sensor_id")

    temperature = data.get("temperature")

    humidity = data.get("humidity")

    pressure = data.get("pressure")

    if sensor_id is None:

        return jsonify({"error": "Missing sensor_id"}), 400

    # Convert incoming values to floats
    try:

        temp_val = float(temperature) if temperature is not None else None

        hum_val = float(humidity) if humidity is not None else None

        pressure_val = float(pressure) if pressure is not None else None

    except (ValueError, TypeError):

        return (
            jsonify({"error": "Invalid temperature, humidity or pressure value"}),
            400,
        )

    timestamp = datetime.now(timezone.utc).isoformat()

    # Retry if SQLite is temporarily busy
    saved = False

    for attempt in range(5):

        try:

            with get_db() as conn:

                cursor = conn.cursor()

                cursor.execute(
                    """
                    INSERT INTO measurements
                    (
                        sensor_id,
                        timestamp,
                        temperature,
                        humidity,
                        pressure
                    )

                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (sensor_id, timestamp, temp_val, hum_val, pressure_val),
                )

                conn.commit()

            saved = True

            break

        except sqlite3.OperationalError as e:

            if "locked" in str(e):

                time.sleep(0.2)

            else:

                raise

    if not saved:

        return jsonify({"error": "Database busy"}), 503

    print(
        f"Received data from sensor {sensor_id}: "
        f"Temp={temp_val}, "
        f"Hum={hum_val}, "
        f"Pressure={pressure_val} hPa "
        f"at {timestamp}"
    )

    return jsonify({"status": "ok"})


# ------------------------
# Website
# ------------------------


@app.route("/")
def home():

    return render_template("index.html")


# ------------------------
# Available sensors
# ------------------------


@app.route("/sensors")
def sensors():

    with get_db() as conn:

        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT DISTINCT sensor_id

            FROM measurements

            ORDER BY sensor_id
            """
        )

        sensors_list = [row[0] for row in cursor.fetchall()]

    return jsonify(sensors_list)


# ------------------------
# Latest reading
# ------------------------


@app.route("/latest")
def latest():

    sensor_id = request.args.get("sensor")

    if not sensor_id:

        return jsonify({"error": "Missing sensor parameter"}), 400

    with get_db() as conn:

        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT
                timestamp,
                temperature,
                humidity,
                pressure

            FROM measurements

            WHERE sensor_id = ?

            ORDER BY id DESC

            LIMIT 1
            """,
            (sensor_id,),
        )

        row = cursor.fetchone()

    if row:

        return jsonify(
            {
                "time": row["timestamp"],
                "temperature": row["temperature"],
                "humidity": row["humidity"],
                "pressure": row["pressure"],
            }
        )

    return jsonify({})


# ------------------------
# Historical graph data
# ------------------------


@app.route("/measurements")
def measurements():

    period = request.args.get("period", "hour")

    sensor_id = request.args.get("sensor")

    if not sensor_id:

        return jsonify([])

    with get_db() as conn:

        cursor = conn.cursor()

        # ------------------------
        # LAST HOUR
        # ------------------------

        if period == "hour":

            query = """

            SELECT
                MIN(timestamp) AS timestamp,

                AVG(temperature) AS temperature,

                AVG(humidity) AS humidity,

                AVG(pressure) AS pressure

            FROM (

                SELECT
                    timestamp,
                    temperature,
                    humidity,
                    pressure,

                    (ROW_NUMBER() OVER
                    (
                        ORDER BY timestamp ASC
                    ) - 1) / 2 AS grp

                FROM measurements

                WHERE sensor_id = ?

                AND datetime(timestamp)
                    >= datetime('now','-1 hour')

            )

            GROUP BY grp

            ORDER BY timestamp ASC

            """

        # ------------------------
        # LAST DAY
        # ------------------------

        elif period == "day":

            query = """

            SELECT
                MIN(timestamp) AS timestamp,

                AVG(temperature) AS temperature,

                AVG(humidity) AS humidity,

                AVG(pressure) AS pressure

            FROM measurements

            WHERE sensor_id = ?

            AND datetime(timestamp)
                >= datetime('now','-1 day')

            GROUP BY

                strftime(
                    '%Y-%m-%d %H:',
                    timestamp
                )

                || (strftime('%M', timestamp) / 10)

            ORDER BY timestamp ASC

            """

        # ------------------------
        # LAST WEEK
        # ------------------------

        elif period == "week":

            query = """

            SELECT
                MIN(timestamp) AS timestamp,

                AVG(temperature) AS temperature,

                AVG(humidity) AS humidity,

                AVG(pressure) AS pressure

            FROM measurements

            WHERE sensor_id = ?

            AND datetime(timestamp)
                >= datetime('now','-7 day')

            GROUP BY
                strftime(
                    '%Y-%m-%d %H',
                    timestamp
                )

            ORDER BY timestamp ASC

            """

        # ------------------------
        # LAST MONTH
        # ------------------------

        elif period == "month":

            query = """

            SELECT
                MIN(timestamp) AS timestamp,

                AVG(temperature) AS temperature,

                AVG(humidity) AS humidity,

                AVG(pressure) AS pressure

            FROM measurements

            WHERE sensor_id = ?

            AND datetime(timestamp)
                >= datetime('now','-30 day')

            GROUP BY

                strftime(
                    '%Y-%m-%d ',
                    timestamp
                )

                || (strftime('%H', timestamp) / 6)

            ORDER BY timestamp ASC

            """

        # ------------------------
        # ALL DATA
        # ------------------------

        else:

            query = """

            SELECT
                strftime(
                    '%Y-%m-%d',
                    timestamp
                ) AS ts,

                AVG(temperature) AS avg_temp,

                AVG(humidity) AS avg_hum,

                AVG(pressure) AS avg_pressure

            FROM measurements

            WHERE sensor_id = ?

            GROUP BY ts

            ORDER BY ts ASC

            """

        cursor.execute(query, (sensor_id,))

        rows = cursor.fetchall()

    # ------------------------
    # Format JSON response
    # ------------------------

    result = []

    for row in rows:

        if period == "all":

            result.append(
                {
                    "time": row["ts"],
                    "temperature": round(row["avg_temp"], 2)
                    if row["avg_temp"] is not None
                    else None,
                    "humidity": round(row["avg_hum"], 2)
                    if row["avg_hum"] is not None
                    else None,
                    "pressure": round(row["avg_pressure"], 2)
                    if row["avg_pressure"] is not None
                    else None,
                }
            )

        else:

            result.append(
                {
                    "time": row["timestamp"],
                    "temperature": round(row["temperature"], 2)
                    if row["temperature"] is not None
                    else None,
                    "humidity": round(row["humidity"], 2)
                    if row["humidity"] is not None
                    else None,
                    "pressure": round(row["pressure"], 2)
                    if row["pressure"] is not None
                    else None,
                }
            )

    return jsonify(result)


# ------------------------
# Start server
# ------------------------

if __name__ == "__main__":

    init_db()

    app.run(host="0.0.0.0", port=5110, debug=True)
