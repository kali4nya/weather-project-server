const STORAGE_KEYS = {
	sensor: "weather.selectedSensor",
	range: "weather.selectedRange",
	theme: "weather.theme"
};

let currentRange = readPreference(STORAGE_KEYS.range) || "hour";
let currentSensor = null;
let chart = null;
let times = [];
let temperatures = [];
let humidities = [];
let pressures = [];


function readPreference(key) {
	try {
		return localStorage.getItem(key);
	} catch (error) {
		return null;
	}
}


function savePreference(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch (error) {}
}


function isCompact() {
	return window.matchMedia("(max-width: 720px)").matches;
}


function parseTimestamp(value) {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	const date = new Date(value);

	if (isNaN(date.getTime())) {
		return null;
	}

	return date.getTime();
}


function formatDateTime(value, options) {
	const timestamp = parseTimestamp(value);

	if (timestamp === null) {
		return value || "--";
	}

	return new Date(timestamp).toLocaleString(
		"en-US",
		options || {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false
		}
	).replace(",", "");
}


function formatTick(timestamp) {
	const compact = isCompact();

	if (currentRange === "hour") {
		return formatDateTime(timestamp, {
			hour: "2-digit",
			minute: "2-digit",
			second: compact ? undefined : "2-digit",
			hour12: false
		});
	}

	if (currentRange === "day") {
		return formatDateTime(timestamp, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false
		});
	}

	if (currentRange === "week") {
		return formatDateTime(timestamp, {
			month: "short",
			day: "numeric",
			hour: compact ? undefined : "2-digit",
			minute: compact ? undefined : "2-digit",
			hour12: false
		});
	}

	return formatDateTime(timestamp, {
		year: currentRange === "all" ? "numeric" : undefined,
		month: "short",
		day: "numeric"
	});
}


function formatCardTime(value) {
	if (isCompact()) {
		return formatDateTime(value, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false
		});
	}

	return formatDateTime(value);
}


function toSeries(timestamps, values) {
	const series = [];

	for (let index = 0; index < timestamps.length; index += 1) {
		const x = timestamps[index];
		const y = values[index];

		if (x === null || y === null || y === undefined) {
			continue;
		}

		series.push({ x, y });
	}

	return series;
}


function densityStyle(pointCount) {
	if (pointCount > 400) {
		return {
			pointRadius: 0,
			borderWidth: 1.25,
			tension: 0
		};
	}

	if (pointCount > 80) {
		return {
			pointRadius: 0,
			borderWidth: 1.5,
			tension: 0.05
		};
	}

	if (pointCount > 24) {
		return {
			pointRadius: 0,
			borderWidth: 2,
			tension: 0.15
		};
	}

	return {
		pointRadius: 2.5,
		borderWidth: 2,
		tension: 0.25
	};
}


function applyChartDensity() {
	if (!chart) {
		return;
	}

	const compact = isCompact();
	const style = densityStyle(times.length);
	const tickFont = { size: compact ? 10 : 12 };

	chart.data.datasets.forEach((dataset) => {
		dataset.pointRadius = style.pointRadius;
		dataset.pointHoverRadius = compact ? 4 : 5;
		dataset.borderWidth = style.borderWidth;
		dataset.tension = style.tension;
		dataset.pointHitRadius = 8;
	});

	chart.data.datasets[0].label = compact ? "Temp °C" : "Temperature °C";
	chart.data.datasets[1].label = compact ? "Humidity %" : "Humidity %";
	chart.data.datasets[2].label = compact ? "Pressure hPa" : "Pressure hPa";

	chart.options.plugins.legend.labels.boxWidth = compact ? 10 : 14;
	chart.options.plugins.legend.labels.font = tickFont;
	chart.options.plugins.legend.labels.padding = compact ? 8 : 12;

	chart.options.scales.x.ticks.maxTicksLimit = compact ? 4 : 8;
	chart.options.scales.x.ticks.font = tickFont;
	chart.options.scales.x.ticks.maxRotation = 0;
	chart.options.scales.x.ticks.minRotation = 0;

	["y-temp", "y-hum", "y-pressure"].forEach((axisId) => {
		const axis = chart.options.scales[axisId];
		axis.title.display = !compact;
		axis.ticks.font = tickFont;
		axis.ticks.padding = compact ? 2 : 4;
		axis.display = axisId === "y-temp" || !compact;
	});

	chart.options.layout.padding = compact
		? { top: 2, right: 8, bottom: 6, left: 2 }
		: { top: 8, right: 8, bottom: 0, left: 0 };

	chart.options.plugins.decimation.enabled = times.length > 180;
	chart.options.plugins.decimation.samples = compact ? 220 : 420;
}


async function loadSensors() {
	try {
		const response = await fetch("/sensors");
		const sensors = await response.json();
		const selector = document.getElementById("sensorSelector");

		selector.innerHTML = "";

		if (sensors.length === 0) {
			const option = document.createElement("option");
			option.textContent = "No sensors found";
			option.disabled = true;
			selector.appendChild(option);
			return;
		}

		sensors.forEach((sensor) => {
			const option = document.createElement("option");
			option.value = sensor;
			option.textContent = sensor;
			selector.appendChild(option);
		});

		const savedSensor = readPreference(STORAGE_KEYS.sensor);

		currentSensor = sensors.includes(savedSensor)
			? savedSensor
			: sensors[0];

		selector.value = currentSensor;
		savePreference(STORAGE_KEYS.sensor, currentSensor);

		createChart();
		await loadHistory();
		await updateLive();

	} catch (error) {
		console.error("Error loading sensors:", error);
	}
}


document.getElementById("sensorSelector").onchange = async function () {
	currentSensor = this.value;
	savePreference(STORAGE_KEYS.sensor, currentSensor);
	resetCards();
	await loadHistory();
	await updateLive();
};


function resetCards() {
	document.getElementById("temperature").textContent = "--";
	document.getElementById("humidity").textContent = "--";
	document.getElementById("pressure").textContent = "--";
	document.getElementById("lastUpdate").textContent = "--";
}


async function loadHistory() {
	if (!currentSensor) {
		return;
	}

	try {
		const response = await fetch(
			`/measurements?sensor=${encodeURIComponent(currentSensor)}&period=${currentRange}`
		);
		const data = await response.json();

		times = [];
		temperatures = [];
		humidities = [];
		pressures = [];

		data.forEach((point) => {
			const timestamp = parseTimestamp(point.time);

			if (timestamp === null) {
				return;
			}

			times.push(timestamp);
			temperatures.push(point.temperature);
			humidities.push(point.humidity);
			pressures.push(point.pressure);
		});

		if (chart) {
			chart.data.datasets[0].data = toSeries(times, temperatures);
			chart.data.datasets[1].data = toSeries(times, humidities);
			chart.data.datasets[2].data = toSeries(times, pressures);
			applyChartDensity();
			chart.update("none");
		}

	} catch (error) {
		console.error("Error loading history:", error);
	}
}


function createChart() {
	const ctx = document.getElementById("chart").getContext("2d");
	const compact = isCompact();

	if (chart) {
		chart.destroy();
	}

	chart = new Chart(ctx, {
		type: "line",
		data: {
			datasets: [
				{
					label: "Temperature °C",
					data: [],
					borderColor: "#ff5722",
					backgroundColor: "rgba(255, 87, 34, 0.12)",
					fill: false,
					yAxisID: "y-temp",
					spanGaps: true
				},
				{
					label: "Humidity %",
					data: [],
					borderColor: "#2196f3",
					backgroundColor: "rgba(33, 150, 243, 0.12)",
					fill: false,
					yAxisID: "y-hum",
					spanGaps: true
				},
				{
					label: "Pressure hPa",
					data: [],
					borderColor: "#4caf50",
					backgroundColor: "rgba(76, 175, 80, 0.12)",
					fill: false,
					yAxisID: "y-pressure",
					spanGaps: true
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			parsing: false,
			normalized: true,
			animation: false,
			interaction: {
				mode: "index",
				intersect: false,
				axis: "x"
			},
			plugins: {
				decimation: {
					enabled: false,
					algorithm: "lttb",
					samples: compact ? 220 : 420,
					threshold: 180
				},
				legend: {
					position: "top",
					labels: {
						usePointStyle: true,
						pointStyle: "line"
					}
				},
				tooltip: {
					callbacks: {
						title: (items) => {
							if (!items.length) {
								return "";
							}

							return formatDateTime(items[0].parsed.x);
						}
					}
				}
			},
			elements: {
				line: {
					capBezierPoints: false
				},
				point: {
					hoverBorderWidth: 2
				}
			},
			scales: {
				x: {
					type: "linear",
					ticks: {
						autoSkip: true,
						maxTicksLimit: compact ? 4 : 8,
						maxRotation: 0,
						minRotation: 0,
						callback: (value) => formatTick(value)
					},
					grid: {
						color: compact
							? "rgba(148, 163, 184, 0.12)"
							: "rgba(148, 163, 184, 0.18)"
					}
				},
				"y-temp": {
					type: "linear",
					position: "left",
					grace: "8%",
					title: {
						display: !compact,
						text: "Temperature (°C)"
					},
					ticks: {
						callback: (value) => (compact ? `${value}` : value)
					}
				},
				"y-hum": {
					type: "linear",
					position: "right",
					grace: "8%",
					title: {
						display: !compact,
						text: "Humidity (%)"
					},
					grid: {
						drawOnChartArea: false
					}
				},
				"y-pressure": {
					type: "linear",
					position: "right",
					grace: "8%",
					title: {
						display: !compact,
						text: "Pressure (hPa)"
					},
					grid: {
						drawOnChartArea: false
					},
					afterFit: (scale) => {
						if (isCompact()) {
							scale.width = Math.min(scale.width, 36);
						}
					}
				}
			}
		}
	});

	applyChartDensity();
}


function setCardValue(id, value, suffix) {
	const element = document.getElementById(id);

	if (value === null || value === undefined) {
		element.textContent = "--";
		return;
	}

	element.textContent = `${Number(value).toFixed(2)} ${suffix}`;
}


async function updateLive() {
	if (!currentSensor) {
		return;
	}

	try {
		const response = await fetch(
			`/latest?sensor=${encodeURIComponent(currentSensor)}`
		);
		const data = await response.json();

		if (
			data.temperature === undefined &&
			data.humidity === undefined &&
			data.pressure === undefined
		) {
			return;
		}

		const timestamp = parseTimestamp(data.time);

		setCardValue("temperature", data.temperature, "°C");
		setCardValue("humidity", data.humidity, "%");
		setCardValue("pressure", data.pressure, "hPa");
		document.getElementById("lastUpdate").textContent = formatCardTime(timestamp);

		if (currentRange !== "hour" || timestamp === null) {
			return;
		}

		const last = times[times.length - 1];

		if (last === timestamp) {
			return;
		}

		times.push(timestamp);
		temperatures.push(data.temperature);
		humidities.push(data.humidity);
		pressures.push(data.pressure);

		if (times.length > 3600) {
			times.shift();
			temperatures.shift();
			humidities.shift();
			pressures.shift();
		}

		if (chart) {
			chart.data.datasets[0].data = toSeries(times, temperatures);
			chart.data.datasets[1].data = toSeries(times, humidities);
			chart.data.datasets[2].data = toSeries(times, pressures);
			applyChartDensity();
			chart.update("none");
		}

	} catch (error) {
		console.warn("Real-time update skipped:", error);
	}
}


function applySavedRange() {
	const validRanges = ["hour", "day", "week", "month", "all"];

	if (!validRanges.includes(currentRange)) {
		currentRange = "hour";
	}

	document.querySelectorAll(".range").forEach((button) => {
		button.classList.toggle(
			"active",
			button.dataset.range === currentRange
		);
	});
}


async function changeRange(range) {
	currentRange = range;
	savePreference(STORAGE_KEYS.range, currentRange);

	document.querySelectorAll(".range").forEach((button) => {
		button.classList.toggle("active", button.dataset.range === range);
	});

	await loadHistory();
}


document.querySelectorAll(".range").forEach((button) => {
	button.addEventListener("click", () => {
		changeRange(button.dataset.range);
	});
});


setInterval(updateLive, 3000);


function applyTheme(isDark) {
	document.documentElement.classList.toggle("dark", isDark);
	document.body.classList.toggle("dark", isDark);

	const themeButton = document.getElementById("theme");
	themeButton.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
}


applyTheme(readPreference(STORAGE_KEYS.theme) === "dark");
applySavedRange();
loadSensors();


document.getElementById("theme").onclick = function () {
	const isDark = !document.documentElement.classList.contains("dark");
	applyTheme(isDark);
	savePreference(STORAGE_KEYS.theme, isDark ? "dark" : "light");
};


let resizeTimer = null;

window.addEventListener("resize", () => {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(() => {
		applyChartDensity();

		if (chart) {
			chart.update("none");
		}
	}, 150);
});
