// DOM references
const bgColor = document.getElementById("bgColor");
const bgColorText = document.getElementById("bgColorText");
const bgLightness = document.getElementById("bgLightness");

const chartColor1 = document.getElementById("chartColor1");
const chartColor1Text = document.getElementById("chartColor1Text");
const chartLightness1 = document.getElementById("chartLightness1");

const chartColor2 = document.getElementById("chartColor2");
const chartColor2Text = document.getElementById("chartColor2Text");
const chartLightness2 = document.getElementById("chartLightness2");

const contrastResults = document.getElementById("contrastResults");
const chartCanvas = document.getElementById("chartCanvas");
const lineChartCanvas = document.getElementById("lineChartCanvas");

const barChartLegend = document.getElementById("barChartLegend");
const lineChartLegend = document.getElementById("lineChartLegend");

// Add these variables at the top with other DOM references
let liveRegionContainer = null;
let hideTimeout = null;

// Add this at the start of the file
let prevStatus = {
  status1: null,
  status2: null,
  status3: null
};

// --- Conversions & WCAG helpers ---
function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    ((1 << 24) + (r << 16) + (g << 8) + b)
      .toString(16)
      .slice(1)
      .toUpperCase()
  );
}

function getLuminance(r, g, b) {
  const sr = r / 255, sg = g / 255, sb = b / 255;
  const rr = sr <= 0.03928 ? sr / 12.92 : Math.pow((sr + 0.055) / 1.055, 2.4);
  const gg = sg <= 0.03928 ? sg / 12.92 : Math.pow((sg + 0.055) / 1.055, 2.4);
  const bb = sb <= 0.03928 ? sb / 12.92 : Math.pow((sb + 0.055) / 1.055, 2.4);
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}

function getContrastRatio(rgb1, rgb2) {
  const lum1 = getLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const lum2 = getLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const brighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (brighter + 0.05) / (darker + 0.05);
}

// RGB → HSV
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  if (max !== min) {
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [h, s, max];
}

// HSV → RGB
function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60),
    f = h / 60 - i,
    p = v * (1 - s),
    q = v * (1 - f * s),
    t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}

// --- Sync color↔slider↔text ---
function syncSliderWithColor(colorInput, slider) {
  const [r, g, b] = hexToRgb(colorInput.value);
  const [h, s, v] = rgbToHsv(r, g, b);
  slider.value = Math.round(v * 100);
}

function syncColorWithSlider(colorInput, slider) {
  const [r, g, b] = hexToRgb(colorInput.value);
  const [h, s, /*v*/] = rgbToHsv(r, g, b);
  const newV = slider.value / 100;
  const [nr, ng, nb] = hsvToRgb(h, s, newV);
  colorInput.value = rgbToHex(nr, ng, nb);
}

function syncTextWithColor(colorInput, textInput) {
  textInput.value = colorInput.value;
}

function syncColorWithText(colorInput, textInput) {
  const val = textInput.value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    colorInput.value = val;
  }
}

function getBestAxisColor(bgRGB) {
  const whiteContrast = getContrastRatio(bgRGB, [255, 255, 255]);
  const blackContrast = getContrastRatio(bgRGB, [0, 0, 0]);
  return whiteContrast > blackContrast ? "#FFFFFF" : "#000000";
}

function drawSmootherLine(ctx, fromX, fromY, toX, toY, color) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  
  // Disable anti-aliasing
  ctx.imageSmoothingEnabled = false;
  
  // For horizontal lines
  if (fromY === toY) {
    const y = Math.floor(fromY) + 0.5;
    ctx.moveTo(Math.floor(fromX), y);
    ctx.lineTo(Math.floor(toX), y);
  }
  // For vertical lines
  else if (fromX === toX) {
    const x = Math.floor(fromX) + 0.5;
    ctx.moveTo(x, Math.floor(fromY));
    ctx.lineTo(x, Math.floor(toY));
  }
  
  ctx.stroke();
  ctx.imageSmoothingEnabled = true; // Reset for other drawing operations
}

/* === Bar Chart (4 bars per category) === */
function drawBarChart(bgRGB, chart1RGB, chart2RGB) {
  const ctx = chartCanvas.getContext("2d");
  const w = chartCanvas.width;
  const h = chartCanvas.height;

  // Clear the canvas before drawing
  ctx.clearRect(0, 0, w, h);

  // Fill background
  ctx.fillStyle = `rgb(${bgRGB[0]}, ${bgRGB[1]}, ${bgRGB[2]})`;
  ctx.fillRect(0, 0, w, h);

  const margin = 30;

  // Axes (using default color, e.g., black)
  const axisColor = getBestAxisColor(bgRGB);

  // Clear any existing anti-aliasing settings
  ctx.imageSmoothingEnabled = true;

  // X-axis
  drawSmootherLine(ctx, margin, h - margin, w - margin, h - margin, axisColor);
  // Y-axis
  drawSmootherLine(ctx, margin, h - margin, margin, margin, axisColor);

  // 2 categories, each with 4 bars (Dataset 1 and 2 repeated)
  const barHeights = [
    [80, 100, 90, 110], // Category A
    [120, 60, 130, 70],  // Category B
  ];
  const color1 = `rgb(${chart1RGB[0]}, ${chart1RGB[1]}, ${chart1RGB[2]})`;
  const color2 = `rgb(${chart2RGB[0]}, ${chart2RGB[1]}, ${chart2RGB[2]})`;
  const colors = [color1, color2];

  // Define bar and gap dimensions
  const barWidth = 25; // Increased from 20 to 25 for slightly wider bars
  const internalGap = 10; // Space between Dataset 1 and Dataset 2 bars within a set
  const setGap = 30; // Space between different sets of bars
  const setWidth = barWidth * 2 + internalGap; // Total width of a set (Dataset 1 + gap + Dataset 2)
  const groupGap = setWidth + setGap; // Gap between different categories

  const startX = margin + 40; // Starting X position for the first category

  for (let c = 0; c < barHeights.length; c++) {
    const category = barHeights[c];

    for (let s = 0; s < 2; s++) { // Two sets per category
      const setX = startX + c * groupGap + s * (setWidth + setGap);

      for (let b = 0; b < 2; b++) { // Two bars per set (Dataset 1 and 2)
        const barIndex = s * 2 + b; // Index to access barHeights
        const barX = setX + b * (barWidth + internalGap);
        const barH = category[barIndex];

        // **Updated Line: Move the bar up by 1 pixel to prevent overlapping the x-axis**
        const barY = (h - margin) - barH - 1; // Subtracting 2 pixels

        ctx.fillStyle = colors[b % colors.length];
        ctx.fillRect(barX, barY, barWidth, barH);
      }
    }
  }
}

/* === Line Chart (extend lines with two more points) === */
function drawLineChart(bgRGB, chart1RGB, chart2RGB) {
  const ctx = lineChartCanvas.getContext("2d");
  const w = lineChartCanvas.width;
  const h = lineChartCanvas.height;

  // Clear the canvas before drawing
  ctx.clearRect(0, 0, w, h);

  // Fill background
  ctx.fillStyle = `rgb(${bgRGB[0]}, ${bgRGB[1]}, ${bgRGB[2]})`;
  ctx.fillRect(0, 0, w, h);

  const margin = 30;


  const axisColor = getBestAxisColor(bgRGB);

  // Clear any existing anti-aliasing settings
  ctx.imageSmoothingEnabled = true;

  // X-axis
  drawSmootherLine(ctx, margin, h - margin, w - margin, h - margin, axisColor);
  // Y-axis
  drawSmootherLine(ctx, margin, h - margin, margin, margin, axisColor);

  // === Line Chart Coordinates ===
  const line1Points = [
    { x: margin + 10, y: (h - margin) - 20 },
    { x: margin + 60, y: (h - margin) - 70 },
    { x: margin + 110, y: (h - margin) - 40 },
    { x: margin + 160, y: (h - margin) - 80 },
    { x: margin + 210, y: (h - margin) - 50 },
    { x: margin + 260, y: (h - margin) - 90 },
    { x: margin + 310, y: (h - margin) - 60 },  // New Point
    { x: margin + 330, y: (h - margin) - 100 }  // Reduced by another 10px from 340 to 330
  ];
  const line2Points = [
    { x: margin + 10, y: (h - margin) - 50 },
    { x: margin + 60, y: (h - margin) - 100 },
    { x: margin + 110, y: (h - margin) - 60 },
    { x: margin + 160, y: (h - margin) - 110 },
    { x: margin + 210, y: (h - margin) - 70 },
    { x: margin + 260, y: (h - margin) - 120 },
    { x: margin + 310, y: (h - margin) - 80 },  // New Point
    { x: margin + 330, y: (h - margin) - 130 }  // Reduced by another 10px from 340 to 330
  ];

  const color1 = `rgb(${chart1RGB[0]}, ${chart1RGB[1]}, ${chart1RGB[2]})`;
  const color2 = `rgb(${chart2RGB[0]}, ${chart2RGB[1]}, ${chart2RGB[2]})`;

  drawSmoothLine(ctx, line1Points, color1);
  drawSmoothLine(ctx, line2Points, color2);

  // Legends are handled outside the canvas
}

function drawSmoothLine(ctx, points, strokeColor) {
  if (!points || points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const xMid = (points[i].x + points[i + 1].x) / 2;
    const yMid = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xMid, yMid);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  const first = points[0];
  ctx.beginPath();
  ctx.arc(first.x, first.y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = strokeColor;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(last.x, last.y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = strokeColor;
  ctx.fill();
}

// --- Update & Contrast ---
function updateCharts() {
  const bgRGB = hexToRgb(bgColor.value);
  const chart1RGB = hexToRgb(chartColor1.value);
  const chart2RGB = hexToRgb(chartColor2.value);

  const ratio1 = getContrastRatio(chart1RGB, bgRGB).toFixed(2);
  const ratio2 = getContrastRatio(chart2RGB, bgRGB).toFixed(2);
  const ratio3 = getContrastRatio(chart1RGB, chart2RGB).toFixed(2);

  const passFail = r => parseFloat(r) >= 3.0 ? "PASS" : "FAIL";
  const borderColor = r => parseFloat(r) >= 3.0 ? "#080" : "#EB0000";

  const currentStatus1 = passFail(ratio1);
  const currentStatus2 = passFail(ratio2);
  const currentStatus3 = passFail(ratio3);

  // Handle live region updates if container exists
  if (liveRegionContainer && (
      currentStatus1 !== prevStatus.status1 || 
      currentStatus2 !== prevStatus.status2 || 
      currentStatus3 !== prevStatus.status3)) {
    
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
    liveRegionContainer.removeAttribute('aria-hidden');

    setTimeout(() => {
      if (currentStatus1 !== prevStatus.status1) {
        document.getElementById('status-live-1').textContent = 
          `Dataset 1 versus background ${currentStatus1}`;
        prevStatus.status1 = currentStatus1;
      }
      if (currentStatus2 !== prevStatus.status2) {
        document.getElementById('status-live-2').textContent = 
          `Dataset 2 versus background ${currentStatus2}`;
        prevStatus.status2 = currentStatus2;
      }
      if (currentStatus3 !== prevStatus.status3) {
        document.getElementById('status-live-3').textContent = 
          `Dataset 1 versus Dataset 2 ${currentStatus3}`;
        prevStatus.status3 = currentStatus3;
      }

      hideTimeout = setTimeout(() => {
        liveRegionContainer.setAttribute('aria-hidden', 'true');
      }, 3000);
    }, 5);
  }

  const status1 = document.getElementById('status1');
  const status2 = document.getElementById('status2');
  const status3 = document.getElementById('status3');

  status1.textContent = currentStatus1;
  status2.textContent = currentStatus2;
  status3.textContent = currentStatus3;

  status1.className = `status-badge ${currentStatus1.toLowerCase()}`;
  status2.className = `status-badge ${currentStatus2.toLowerCase()}`;
  status3.className = `status-badge ${currentStatus3.toLowerCase()}`;

  const box1 = `
    <div class="contrast-box" style="border-color: ${borderColor(ratio1)};">
      <span class="cbtitle"><span>Dataset 1 Color </span> <span>vs</span> <span> Background Color</span></span>
      <span class="contrast-ratio">${ratio1}<span>:</span>1</span>
      <span class="contrast-ratio-text">WCAG 1.4.11: ${currentStatus1}</span>
    </div>
  `;
  const box2 = `
    <div class="contrast-box" style="border-color: ${borderColor(ratio2)};">
      <span class="cbtitle"><span>Dataset 2 Color </span> <span>vs</span> <span> Background Color</span></span>
      <span class="contrast-ratio">${ratio2}<span>:</span>1</span>
      <span class="contrast-ratio-text">WCAG 1.4.11: ${currentStatus2}</span>
    </div>
  `;
  const box3 = `
    <div class="contrast-box" style="border-color: ${borderColor(ratio3)};">
      <span class="cbtitle"><span>Dataset 1 Color </span> <span>vs</span> <span> Dataset 2 Color</span></span>
      <span class="contrast-ratio">${ratio3}<span>:</span>1</span>
      <span class="contrast-ratio-text">WCAG 1.4.1: ${currentStatus3}</span>
    </div>
  `;
  contrastResults.innerHTML = box1 + box2 + box3;

  drawBarChart(bgRGB, chart1RGB, chart2RGB);
  drawLineChart(bgRGB, chart1RGB, chart2RGB);

  updateLegends(chart1RGB, chart2RGB);
  updatePermalink();
}

// --- Update Legends ---
function updateLegends(chart1RGB, chart2RGB) {
  // Format colors for CSS
  const color1 = `rgb(${chart1RGB[0]}, ${chart1RGB[1]}, ${chart1RGB[2]})`;
  const color2 = `rgb(${chart2RGB[0]}, ${chart2RGB[1]}, ${chart2RGB[2]})`;

  // Update Bar Chart Legend
  barChartLegend.innerHTML = `
    <span class="legend-item">
      <span class="color-square" style="background-color: ${color1};"></span>
      <span class="legend-text">Dataset 1</span>
    </span>
    <span class="legend-item">
      <span class="color-square" style="background-color: ${color2};"></span>
      <span class="legend-text">Dataset 2</span>
    </span>
  `;

  // Update Line Chart Legend
  lineChartLegend.innerHTML = `
    <span class="legend-item">
      <span class="color-square" style="background-color: ${color1};"></span>
      <span class="legend-text">Dataset 1</span>
    </span>
    <span class="legend-item">
      <span class="color-square" style="background-color: ${color2};"></span>
      <span class="legend-text">Dataset 2</span>
    </span>
  `;
}

// Add this function to update the permalink
function updatePermalink() {
  const params = new URLSearchParams({
    bgcolor: bgColor.value,
    datacolor1: chartColor1.value,
    datacolor2: chartColor2.value
  });
  
  const permalink = document.querySelector('#permalink a');
  permalink.href = `${window.location.pathname}?${params.toString()}`;
}

// Add this function to handle URL parameters on page load
function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  
  if (params.has('bgcolor')) {
    const bgColorValue = params.get('bgcolor');
    if (/^#[0-9A-Fa-f]{6}$/.test(bgColorValue)) {
      bgColor.value = bgColorValue;
      bgColorText.value = bgColorValue;
      syncSliderWithColor(bgColor, bgLightness);
    }
  }
  
  if (params.has('datacolor1')) {
    const color1Value = params.get('datacolor1');
    if (/^#[0-9A-Fa-f]{6}$/.test(color1Value)) {
      chartColor1.value = color1Value;
      chartColor1Text.value = color1Value;
      syncSliderWithColor(chartColor1, chartLightness1);
    }
  }
  
  if (params.has('datacolor2')) {
    const color2Value = params.get('datacolor2');
    if (/^#[0-9A-Fa-f]{6}$/.test(color2Value)) {
      chartColor2.value = color2Value;
      chartColor2Text.value = color2Value;
      syncSliderWithColor(chartColor2, chartLightness2);
    }
  }
}

// --- Event Listeners & Initialization ---
bgColor.addEventListener('input', () => {
  syncSliderWithColor(bgColor, bgLightness);
  syncTextWithColor(bgColor, bgColorText);
  updateCharts();
});
bgColorText.addEventListener('input', () => {
  syncColorWithText(bgColor, bgColorText);
  syncSliderWithColor(bgColor, bgLightness);
  updateCharts();
});
bgLightness.addEventListener('input', () => {
  syncColorWithSlider(bgColor, bgLightness);
  syncTextWithColor(bgColor, bgColorText);
  updateCharts();
});

chartColor1.addEventListener('input', () => {
  syncSliderWithColor(chartColor1, chartLightness1);
  syncTextWithColor(chartColor1, chartColor1Text);
  updateCharts();
});
chartColor1Text.addEventListener('input', () => {
  syncColorWithText(chartColor1, chartColor1Text);
  syncSliderWithColor(chartColor1, chartLightness1);
  updateCharts();
});
chartLightness1.addEventListener('input', () => {
  syncColorWithSlider(chartColor1, chartLightness1);
  syncTextWithColor(chartColor1, chartColor1Text);
  updateCharts();
});

chartColor2.addEventListener('input', () => {
  syncSliderWithColor(chartColor2, chartLightness2);
  syncTextWithColor(chartColor2, chartColor2Text);
  updateCharts();
});
chartColor2Text.addEventListener('input', () => {
  syncColorWithText(chartColor2, chartColor2Text);
  syncSliderWithColor(chartColor2, chartLightness2);
  updateCharts();
});
chartLightness2.addEventListener('input', () => {
  syncColorWithSlider(chartColor2, chartLightness2);
  syncTextWithColor(chartColor2, chartColor2Text);
  updateCharts();
});

window.addEventListener('DOMContentLoaded', () => {
  // Initialize the live region container
  liveRegionContainer = document.querySelector('.visually-hidden');
  
  // Handle URL parameters first
  handleUrlParams();

  // Initial synchronization
  syncSliderWithColor(bgColor, bgLightness);
  syncTextWithColor(bgColor, bgColorText);

  syncSliderWithColor(chartColor1, chartLightness1);
  syncTextWithColor(chartColor1, chartColor1Text);

  syncSliderWithColor(chartColor2, chartLightness2);
  syncTextWithColor(chartColor2, chartColor2Text);

  // Initial chart drawing
  updateCharts();
});


