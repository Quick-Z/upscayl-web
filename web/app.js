const MODELS = {
  "upscayl-standard-4x": {
    name: "Upscayl 标准",
    description: "适用于大多数图像，整体效果均衡。",
  },
  "upscayl-lite-4x": {
    name: "Upscayl 轻量版",
    description: "适用于大多数图像，速度较快，质量损失较小。",
  },
  "high-fidelity-4x": {
    name: "高保真",
    description: "注重还原真实细节和平滑纹理，适合照片。",
  },
  "remacri-4x": {
    name: "Remacri · 非商业用途",
    description: "适合自然图像，强调锐度和细节。",
  },
  "ultramix-balanced-4x": {
    name: "Ultramix · 非商业用途",
    description: "适合自然图像，在锐度和细节之间取得平衡。",
  },
  "ultrasharp-4x": {
    name: "Ultrasharp · 非商业用途",
    description: "适合自然图像，重点增强边缘和纹理锐度。",
  },
  "digital-art-4x": {
    name: "数字艺术",
    description: "适合数字艺术、插画、动漫和清晰线稿。",
  },
};

const $ = (id) => document.getElementById(id);
const elements = {
  apiBase: $("apiBaseInput"),
  connectionPill: $("connectionPill"),
  connectionText: $("connectionText"),
  fileInput: $("fileInput"),
  dropzone: $("dropzone"),
  dropzoneCopy: $("dropzoneCopy"),
  inputPreview: $("inputPreview"),
  fileRow: $("fileRow"),
  fileName: $("fileName"),
  fileSize: $("fileSize"),
  clearFile: $("clearFile"),
  modelSelect: $("modelSelect"),
  modelDescription: $("modelDescription"),
  scaleSelect: $("scaleSelect"),
  formatSelect: $("formatSelect"),
  tileSelect: $("tileSelect"),
  gpuInput: $("gpuInput"),
  ttaToggle: $("ttaToggle"),
  upscaleButton: $("upscaleButton"),
  healthButton: $("healthButton"),
  errorMessage: $("errorMessage"),
  resultStage: $("resultStage"),
  resultStatus: $("resultStatus"),
  emptyResult: $("emptyResult"),
  loadingResult: $("loadingResult"),
  outputPreview: $("outputPreview"),
  resultFooter: $("resultFooter"),
  outputInfo: $("outputInfo"),
  outputName: $("outputName"),
  downloadButton: $("downloadButton"),
};

let selectedFile = null;
let outputUrl = null;

function apiBase() {
  return elements.apiBase.value.trim().replace(/\/$/, "");
}

function setConnection(state, text) {
  elements.connectionPill.dataset.state = state;
  elements.connectionText.textContent = text;
}

function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = false;
}

function clearError() {
  elements.errorMessage.hidden = true;
  elements.errorMessage.textContent = "";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setFile(file) {
  clearError();
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    showError("只支持 PNG、JPG/JPEG 和 WEBP 图片。");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showError("图片超过 API 的 50 MB 大小限制。");
    return;
  }
  selectedFile = file;
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = `${formatBytes(file.size)} · ${file.type}`;
  elements.fileRow.hidden = false;
  elements.dropzone.classList.add("has-image");
  elements.inputPreview.src = URL.createObjectURL(file);
  elements.resultStatus.textContent = "已选择图片";
}

function clearFile() {
  selectedFile = null;
  elements.fileInput.value = "";
  elements.fileRow.hidden = true;
  elements.dropzone.classList.remove("has-image");
  elements.inputPreview.removeAttribute("src");
  elements.resultStatus.textContent = "等待图片";
}

function populateModels() {
  for (const [id, model] of Object.entries(MODELS)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${model.name}  ·  ${id}`;
    elements.modelSelect.appendChild(option);
  }
  updateModelDescription();
}

function updateModelDescription() {
  elements.modelDescription.textContent = MODELS[elements.modelSelect.value]?.description || "—";
}

async function checkHealth() {
  clearError();
  setConnection("idle", "检查中…");
  try {
    const response = await fetch(`${apiBase()}/health`, { method: "GET" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== "ok") throw new Error("API 状态异常");
    setConnection("ok", data.activeJob ? "API 在线 · 处理中" : "API 在线");
  } catch (error) {
    setConnection("error", "无法连接");
    showError(`无法连接到 API：${error.message}。请确认已运行 npm run api，并检查 endpoint。`);
  }
}

function setLoading(isLoading) {
  elements.upscaleButton.disabled = isLoading;
  elements.upscaleButton.querySelector("span:first-child").textContent = isLoading ? "处理中…" : "开始升图";
  elements.loadingResult.hidden = !isLoading;
  elements.emptyResult.hidden = isLoading;
  elements.resultStage.classList.toggle("has-output", false);
  elements.resultStatus.textContent = isLoading ? "正在处理" : "等待图片";
}

async function upscale() {
  clearError();
  if (!selectedFile) {
    showError("请先选择一张图片。");
    return;
  }
  const params = new URLSearchParams({
    model: elements.modelSelect.value,
    scale: elements.scaleSelect.value,
    format: elements.formatSelect.value,
    tileSize: elements.tileSelect.value,
  });
  const gpuId = elements.gpuInput.value.trim();
  if (gpuId) params.set("gpuId", gpuId);
  if (elements.ttaToggle.checked) params.set("tta", "true");

  setLoading(true);
  try {
    const response = await fetch(`${apiBase()}/api/upscale?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": selectedFile.type },
      body: selectedFile,
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data.error) message = data.error;
      } catch (_) {
        // Keep the HTTP status if the server did not return JSON.
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    const extension = elements.formatSelect.value;
    const filename = `upscaled-${elements.modelSelect.value}-${elements.scaleSelect.value}x.${extension}`;
    elements.outputPreview.src = outputUrl;
    elements.outputPreview.alt = `${filename} 扩图结果`;
    elements.outputName.textContent = filename;
    elements.outputInfo.textContent = `${formatBytes(blob.size)} · ${blob.type || `image/${extension}`}`;
    elements.downloadButton.href = outputUrl;
    elements.downloadButton.download = filename;
    elements.resultStage.classList.add("has-output");
    elements.resultFooter.hidden = false;
    elements.resultStatus.textContent = "处理完成";
    setConnection("ok", "API 在线");
  } catch (error) {
    elements.resultStatus.textContent = "处理失败";
    showError(`扩图失败：${error.message}`);
  } finally {
    elements.upscaleButton.disabled = false;
    elements.upscaleButton.querySelector("span:first-child").textContent = "开始升图";
    elements.loadingResult.hidden = true;
    if (!elements.resultStage.classList.contains("has-output")) elements.emptyResult.hidden = false;
  }
}

elements.fileInput.addEventListener("change", (event) => setFile(event.target.files[0]));
elements.clearFile.addEventListener("click", clearFile);
elements.modelSelect.addEventListener("change", updateModelDescription);
elements.healthButton.addEventListener("click", checkHealth);
elements.upscaleButton.addEventListener("click", upscale);
elements.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});
["dragenter", "dragover"].forEach((eventName) => elements.dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  elements.dropzone.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((eventName) => elements.dropzone.addEventListener(eventName, (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("is-dragging");
}));
elements.dropzone.addEventListener("drop", (event) => setFile(event.dataTransfer.files[0]));
elements.apiBase.addEventListener("change", () => setConnection("idle", "未连接"));

populateModels();
checkHealth();
