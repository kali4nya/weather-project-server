from flask import Flask, request, jsonify, render_template
import sqlite3
from datetime import datetime
import logging


app = Flask(__name__)


# Hide Flask request logs
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)


DATABASE = "sensor_data.db"


# ------------------------
# Database setup
# ------------------------


def init_db():

    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()

    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS measurements (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        sensor_id TEXT NOT NULL,

        timestamp DATETIME,

        temperature REAL,

        humidity REAL

    )
    """
    )

    cursor.execute(
        """
    CREATE INDEX IF NOT EXISTS idx_sensor_time
    ON measurements(sensor_id, timestamp)
    """
    )

    conn.commit()

    conn.close()


# ------------------------
# Receive ESP32 data
# ------------------------


@app.route("/sensor", methods=["POST"])
def sensor():

    data = request.json

    if not data:

        return {"error": "No JSON received"}, 400

    sensor_id = data.get("sensor_id")

    temperature = data.get("temperature")

    humidity = data.get("humidity")

    if sensor_id is None:

        return {"error": "Missing sensor_id"}, 400

    timestamp = datetime.now()

    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO measurements
        (
            sensor_id,
            timestamp,
            temperature,
            humidity
        )

        VALUES (?, ?, ?, ?)

        """,
        (sensor_id, timestamp, temperature, humidity),
    )

    conn.commit()

    conn.close()

    print(f"{sensor_id} | " f"{timestamp} | " f"{temperature} °C | " f"{humidity} %")

    return {"status": "ok"}


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

    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT DISTINCT sensor_id
        FROM measurements
        ORDER BY sensor_id
        """
    )

    sensors = [row[0] for row in cursor.fetchall()]

    conn.close()

    return jsonify(sensors)


# ------------------------
# Latest reading
# ------------------------


@app.route("/latest")
def latest():

    sensor_id = request.args.get("sensor")

    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()

    if sensor_id:

        cursor.execute(
            """
            SELECT
                timestamp,
                temperature,
                humidity

            FROM measurements

            WHERE sensor_id = ?

            ORDER BY id DESC

            LIMIT 1

            """,
            (sensor_id,),
        )

    else:

        cursor.execute(
            """
            SELECT
                timestamp,
                temperature,
                humidity

            FROM measurements

            ORDER BY id DESC

            LIMIT 1
            """
        )

    row = cursor.fetchone()

    conn.close()

    if row:

        return jsonify({"time": row[0], "temperature": row[1], "humidity": row[2]})

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

    conn = sqlite3.connect(DATABASE)

    cursor = conn.cursor()

    if period == "hour":

        query = """
        SELECT
            timestamp,
            temperature,
            humidity

        FROM measurements

        WHERE sensor_id = ?

        AND timestamp >= datetime('now','-1 hour')

        ORDER BY timestamp
        """

    elif period == "day":

        query = """
        SELECT

            strftime('%Y-%m-%d %H:%M',
            timestamp),

            AVG(temperature),

            AVG(humidity)


        FROM measurements


        WHERE sensor_id = ?

        AND timestamp >= datetime('now','-1 day')


        GROUP BY 1

        ORDER BY 1
        """

    elif period == "week":

        query = """
        SELECT

            strftime('%Y-%m-%d %H',
            timestamp),

            AVG(temperature),

            AVG(humidity)


        FROM measurements


        WHERE sensor_id = ?

        AND timestamp >= datetime('now','-7 day')


        GROUP BY 1

        ORDER BY 1
        """

    elif period == "month":

        query = """
        SELECT

            strftime('%Y-%m-%d %H',
            timestamp),

            AVG(temperature),

            AVG(humidity)


        FROM measurements


        WHERE sensor_id = ?

        AND timestamp >= datetime('now','-30 day')


        GROUP BY 1

        ORDER BY 1
        """

    else:

        query = """
        SELECT

            strftime('%Y-%m-%d',
            timestamp),

            AVG(temperature),

            AVG(humidity)


        FROM measurements


        WHERE sensor_id = ?


        GROUP BY 1


        ORDER BY 1
        """

    cursor.execute(query, (sensor_id,))

    rows = cursor.fetchall()

    conn.close()

    return jsonify(
        [{"time": row[0], "temperature": row[1], "humidity": row[2]} for row in rows]
    )


# ------------------------
# Start server
# ------------------------

if __name__ == "__main__":

    init_db()

    app.run(host="0.0.0.0", port=5110, debug=True)
