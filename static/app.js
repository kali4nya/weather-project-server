let currentRange = "hour";

let currentSensor = null;

let chart;

let times = [];
let temperatures = [];
let humidities = [];

// -------------------------
// Load sensors
// -------------------------

async function loadSensors() {
  let response = await fetch("/sensors");

  let sensors = await response.json();

  let selector = document.getElementById("sensorSelector");

  selector.innerHTML = "";

  sensors.forEach((sensor) => {
    let option = document.createElement("option");

    option.value = sensor;

    option.textContent = sensor;

    selector.appendChild(option);
  });

  if (sensors.length > 0) {
    currentSensor = sensors[0];

    selector.value = currentSensor;

    loadHistory();
  }

  selector.onchange = function () {
    currentSensor = this.value;

    resetCards();

    loadHistory();
  };
}

// -------------------------
// Reset cards
// -------------------------

function resetCards() {
  document.getElementById("temperature").innerHTML = "--";

  document.getElementById("humidity").innerHTML = "--";

  document.getElementById("lastUpdate").innerHTML = "--";
}

// -------------------------
// Load graph history
// -------------------------

async function loadHistory() {
  if (!currentSensor) {
    return;
  }

  let response = await fetch(
    "/measurements?sensor=" + currentSensor + "&period=" + currentRange,
  );

  let data = await response.json();

  times = [];
  temperatures = [];
  humidities = [];

  data.forEach((point) => {
    times.push(point.time);

    temperatures.push(point.temperature);

    humidities.push(point.humidity);
  });

  if (chart) {
    chart.destroy();
  }

  createChart();
}

// -------------------------
// Create chart
// -------------------------

function createChart() {
  chart = new Chart(
    document.getElementById("chart"),

    {
      type: "line",

      data: {
        labels: times,

        datasets: [
          {
            label: "Temperature °C",

            data: temperatures,

            borderWidth: 2,
          },

          {
            label: "Humidity %",

            data: humidities,

            borderWidth: 2,
          },
        ],
      },

      options: {
        animation: false,

        scales: {
          x: {
            display: false,
          },
        },
      },
    },
  );
}

// -------------------------
// Live update
// -------------------------

async function updateLive() {
  if (!currentSensor) {
    return;
  }

  let response = await fetch("/latest?sensor=" + currentSensor);

  let data = await response.json();

  if (data.temperature == null) {
    return;
  }

  document.getElementById("temperature").innerHTML =
    data.temperature.toFixed(2) + " °C";

  document.getElementById("humidity").innerHTML =
    data.humidity.toFixed(2) + " %";

  document.getElementById("lastUpdate").innerHTML = data.time;

  let last = times[times.length - 1];

  if (last == data.time) {
    return;
  }

  times.push(data.time);

  temperatures.push(data.temperature);

  humidities.push(data.humidity);

  if (times.length > 500) {
    times.shift();

    temperatures.shift();

    humidities.shift();
  }

  if (chart) {
    chart.update();
  }
}

// every second

setInterval(updateLive, 1000);

// startup

loadSensors();

// dark mode

document.getElementById("theme").onclick = function () {
  document.body.classList.toggle("dark");
};

// range buttons

function changeRange(button, range) {
  currentRange = range;

  document.querySelectorAll(".range").forEach((btn) => {
    btn.classList.remove("active");
  });

  button.classList.add("active");

  loadHistory();
}
