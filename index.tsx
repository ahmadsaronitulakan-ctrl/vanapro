/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GenerateVideosParameters, GoogleGenAI} from '@google/genai';

// Data structure for managing image-prompt pairs
interface ImagePromptPair {
  id: number;
  file: File;
  base64data: string;
  mimeType: string;
  prompt: string;
}

let imagePromptPairs: ImagePromptPair[] = [];
let nextId = 0;

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.split(',')[1]);
    };
    // FIX: Corrected method name from readDataURL to readAsDataURL.
    reader.readAsDataURL(blob);
  });
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// FIX: Aligned with GoogleGenAI SDK guidelines to use process.env.API_KEY exclusively.
// Removed UI input for API key and multi-key rotation logic.
function getGenAIInstance(): GoogleGenAI {
  return new GoogleGenAI({apiKey: process.env.API_KEY});
}

async function analyzeImageAndGeneratePrompt(
  imageBytes: string,
  imageMimeType: string,
): Promise<string> {
  const ai = getGenAIInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: imageMimeType,
            data: imageBytes,
          },
        },
        {
          text: 'Describe this image in a creative and detailed way to be used as a prompt for a video generation model.',
        },
      ],
    },
  });
  return response.text;
}

async function generateContent(
  params: GenerateVideosParameters,
  batchIndex?: number,
) {
  const ai = getGenAIInstance();
  let operation = await ai.models.generateVideos(params);

  while (!operation.done) {
    console.log('Waiting for completion');
    // FIX: Increased polling delay to 10 seconds as recommended for video generation.
    await delay(10000); // Check status every 10 seconds
    operation = await ai.operations.getVideosOperation({operation});
  }

  const videos = operation.response?.generatedVideos;
  if (videos === undefined || videos.length === 0) {
    throw new Error('No videos generated');
  }

  videos.forEach(async (v, i) => {
    const url = decodeURIComponent(v.video.uri);
    // FIX: Appended API key to the fetch URL for video download, as required by the API.
    const res = await fetch(`${url}&key=${process.env.API_KEY}`);
    const blob = await res.blob();
    const objectURL = URL.createObjectURL(blob);

    const videoEl = document.createElement('video');
    videoEl.src = objectURL;
    videoEl.controls = true;
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.loop = true;
    videoPreviewsContainer.appendChild(videoEl);

    const filename = `video-${batchIndex !== undefined ? batchIndex : 0}-${i}.mp4`;
    downloadFile(objectURL, filename);
    console.log('Downloaded video', filename);
  });
}

// --- DOM Element References ---
const batchUploadInput = document.querySelector(
  '#batch-file-input',
) as HTMLInputElement;
const imagePromptListContainer = document.querySelector(
  '#image-prompt-list',
) as HTMLDivElement;
const modelEl = document.querySelector('#model-select') as HTMLSelectElement;
const aspectRatioEl = document.querySelector(
  '#aspect-ratio-select',
) as HTMLSelectElement;
const durationEl = document.querySelector(
  '#duration-select',
) as HTMLSelectElement;
const negativePromptEl = document.querySelector(
  '#negative-prompt-input',
) as HTMLTextAreaElement;
const numVideosEl = document.querySelector(
  '#number-of-videos-input',
) as HTMLInputElement;
const fpsEl = document.querySelector('#fps-input') as HTMLInputElement;
const seedEl = document.querySelector('#seed-input') as HTMLInputElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const generateAllPromptsButton = document.querySelector(
  '#generate-all-prompts-button',
) as HTMLButtonElement;
const statusEl = document.querySelector('#status') as HTMLDivElement;
const videoPreviewsContainer = document.querySelector(
  '#video-previews',
) as HTMLDivElement;

// --- Core Functions ---
function renderImagePromptList() {
  imagePromptListContainer.innerHTML = '';
  imagePromptPairs.forEach((pair) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'image-prompt-item';
    itemEl.innerHTML = `
      <img src="${URL.createObjectURL(pair.file)}" alt="Image preview for prompt">
      <div>
        <label for="prompt-${pair.id}">Prompt untuk Gambar Ini (opsional)</label>
        <textarea id="prompt-${pair.id}" class="prompt-textarea" rows="4" placeholder="Kosongkan untuk generate otomatis">${pair.prompt}</textarea>
        <div class="prompt-actions">
           <button class="generate-single-prompt-button" data-id="${pair.id}">✨ Buat Prompt dari Gambar</button>
           <button class="delete-item-button" data-id="${pair.id}">× Hapus</button>
        </div>
      </div>
    `;
    imagePromptListContainer.appendChild(itemEl);
  });
}

function attachEventListenersToList() {
  imagePromptListContainer.addEventListener('input', (e) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.classList.contains('prompt-textarea')) {
      const id = parseInt(target.id.split('-')[1], 10);
      const pair = imagePromptPairs.find((p) => p.id === id);
      if (pair) {
        pair.prompt = target.value;
      }
    }
  });

  imagePromptListContainer.addEventListener('click', async (e) => {
    const target = e.target as HTMLButtonElement;
    const id = parseInt(target.dataset.id, 10);
    const pair = imagePromptPairs.find((p) => p.id === id);

    if (target.classList.contains('delete-item-button')) {
      imagePromptPairs = imagePromptPairs.filter((p) => p.id !== id);
      renderImagePromptList();
      updateButtonStates();
    } else if (target.classList.contains('generate-single-prompt-button')) {
      if (!pair) return;
      const textarea = document.querySelector(
        `#prompt-${id}`,
      ) as HTMLTextAreaElement;
      textarea.value = 'Generating...';
      textarea.disabled = true;
      target.disabled = true;
      try {
        const generatedPrompt = await analyzeImageAndGeneratePrompt(
          pair.base64data,
          pair.mimeType,
        );
        pair.prompt = generatedPrompt;
        textarea.value = generatedPrompt;
      } catch (err) {
        // FIX: Removed specific error message for invalid API key to comply with guidelines.
        const errorMessage = err.message;
        textarea.value = `Error: ${errorMessage}`;
        statusEl.innerText = `Error: ${errorMessage}`;
      } finally {
        textarea.disabled = false;
        target.disabled = false;
      }
    }
  });
}

// FIX: Updated to not rely on API key input from the UI.
function updateButtonStates() {
  const canGenerate = imagePromptPairs.length > 0;
  generateButton.disabled = !canGenerate;
  generateAllPromptsButton.disabled = !canGenerate;
}

batchUploadInput.addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  statusEl.innerText = 'Processing images...';
  setControlsDisabled(true);

  const fileArray = Array.from(files);
  for (const file of fileArray) {
    const base64data = await blobToBase64(file);
    imagePromptPairs.push({
      id: nextId++,
      file: file,
      base64data,
      mimeType: file.type,
      prompt: '',
    });
  }

  renderImagePromptList();
  statusEl.innerText = `${files.length} image(s) ready.`;
  setControlsDisabled(false);
});

generateAllPromptsButton.addEventListener('click', async () => {
  statusEl.innerText = 'Generating all prompts...';
  setControlsDisabled(true);

  for (const pair of imagePromptPairs) {
    if (!pair.prompt) {
      // Only generate if prompt is empty
      const textarea = document.querySelector(
        `#prompt-${pair.id}`,
      ) as HTMLTextAreaElement;
      textarea.value = 'Generating...';
      try {
        const generatedPrompt = await analyzeImageAndGeneratePrompt(
          pair.base64data,
          pair.mimeType,
        );
        pair.prompt = generatedPrompt;
        textarea.value = generatedPrompt;
      } catch (err) {
        // FIX: Removed specific error message for invalid API key to comply with guidelines.
        const errorMessage = err.message;
        textarea.value = `Error: ${errorMessage}`;
        statusEl.innerText = `Error: ${errorMessage}`; // Show error in main status too
      }
    }
  }

  statusEl.innerText = 'All prompts generated.';
  setControlsDisabled(false);
});

function setControlsDisabled(disabled: boolean) {
  batchUploadInput.disabled = disabled;
  // Disable all inputs/selects
  // FIX: Removed apiKeyInput from the list of disabled controls.
  [
    negativePromptEl,
    durationEl,
    aspectRatioEl,
    modelEl,
    numVideosEl,
    fpsEl,
    seedEl,
  ].forEach((el) => (el.disabled = disabled));
  // Disable textareas and buttons in the list
  document
    .querySelectorAll('.prompt-textarea, .generate-single-prompt-button, .delete-item-button')
    .forEach((el) => ((el as HTMLInputElement).disabled = disabled));

  if (disabled) {
    generateButton.disabled = true;
    generateAllPromptsButton.disabled = true;
  } else {
    updateButtonStates();
  }
}

function buildParams(pair: ImagePromptPair): GenerateVideosParameters {
  const params: GenerateVideosParameters = {
    model: modelEl.value,
    prompt: pair.prompt,
    image: {
      imageBytes: pair.base64data,
      mimeType: pair.mimeType,
    },
    config: {
      durationSeconds: parseInt(durationEl.value, 10),
      aspectRatio: aspectRatioEl.value,
      numberOfVideos: parseInt(numVideosEl.value, 10),
    },
  };

  if (negativePromptEl.value) {
    params.config.negativePrompt = negativePromptEl.value;
  }
  if (fpsEl.value) {
    params.config.fps = parseInt(fpsEl.value, 10);
  }
  if (seedEl.value) {
    params.config.seed = parseInt(seedEl.value, 10);
  }
  return params;
}

generateButton.addEventListener('click', async () => {
  if (imagePromptPairs.length === 0) {
    alert('Please select at least one image.');
    return;
  }

  statusEl.innerText = 'Starting generation...';
  videoPreviewsContainer.innerHTML = '';
  setControlsDisabled(true);

  try {
    for (let i = 0; i < imagePromptPairs.length; i++) {
      const pair = imagePromptPairs[i];
      let currentPrompt = pair.prompt;

      if (!currentPrompt) {
        statusEl.innerText = `Analyzing image ${i + 1}/${imagePromptPairs.length}...`;
        currentPrompt = await analyzeImageAndGeneratePrompt(
          pair.base64data,
          pair.mimeType,
        );
        pair.prompt = currentPrompt;
        // Update UI with generated prompt
        const textarea = document.querySelector(
          `#prompt-${pair.id}`,
        ) as HTMLTextAreaElement;
        textarea.value = currentPrompt;
      }

      statusEl.innerText = `Generating video ${i + 1}/${
        imagePromptPairs.length
      }...`;
      const params = buildParams(pair);
      await generateContent(params, i);
    }
    statusEl.innerText = 'Batch generation complete.';
  } catch (e) {
    // FIX: Removed specific error message for invalid API key to comply with guidelines.
    const errorMessage = e.message;
    statusEl.innerText = `An error occurred: ${errorMessage}`;
    console.error('Generation error:', e);
  } finally {
    setControlsDisabled(false);
  }
});

// Initial setup
attachEventListenersToList();
updateButtonStates(); // Set initial button states