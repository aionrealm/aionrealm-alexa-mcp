// Client-side logic for the simulated Alexa+ device demo. This file never
// holds, sends, or receives MCP_SERVER_AUTH_TOKEN -- it only ever talks to
// this same-origin demo server's own /api/ask endpoint, which is what
// actually calls the live MCP server (see server.js).

const device = document.getElementById("device");
const deviceStatus = document.getElementById("deviceStatus");
const questionInput = document.getElementById("questionInput");
const askButton = document.getElementById("askButton");
const micButton = document.getElementById("micButton");
const quickPrompts = document.getElementById("quickPrompts");
const showPanelBody = document.getElementById("showPanelBody");

const STATUS_LABEL = {
  idle: "Ready",
  listening: "Listening…",
  connecting: "Connecting to AionRealm…",
  responding: "Aion is responding…",
  error: "Aion could not be reached",
};

function setState(state) {
  device.dataset.state = state;
  deviceStatus.textContent = STATUS_LABEL[state] || "Ready";
}

function setBusy(busy) {
  askButton.disabled = busy;
  questionInput.disabled = busy;
}

function appendTurn(who, text, { isError = false } = {}) {
  let transcript = showPanelBody.querySelector(".transcript");
  if (!transcript) {
    showPanelBody.innerHTML = "";
    transcript = document.createElement("div");
    transcript.className = "transcript";
    showPanelBody.appendChild(transcript);
  }
  const turn = document.createElement("div");
  turn.className = "transcript-turn" + (isError ? " error" : "");
  const whoEl = document.createElement("p");
  whoEl.className = "who";
  whoEl.textContent = who;
  const whatEl = document.createElement("p");
  whatEl.className = "what";
  whatEl.textContent = text;
  turn.append(whoEl, whatEl);
  transcript.appendChild(turn);
  showPanelBody.scrollTop = showPanelBody.scrollHeight;
}

async function ask(question) {
  if (!question) return;
  setBusy(true);
  appendTurn("You asked", question);

  // Brief "listening" beat before showing the request is actually moving --
  // purely a UX pacing choice, not simulating any additional real latency.
  setState("listening");
  await new Promise((resolve) => setTimeout(resolve, 350));

  setState("connecting");
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    setState("responding");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error || `Request failed (HTTP ${response.status})`);
    }
    appendTurn("Aion responded", data.text);
    setState("idle");
  } catch (error) {
    appendTurn("Aion responded", error.message || "Aion could not be reached right now.", {
      isError: true,
    });
    setState("error");
    setTimeout(() => setState("idle"), 2000);
  } finally {
    setBusy(false);
  }
}

askButton.addEventListener("click", () => {
  const question = questionInput.value.trim();
  questionInput.value = "";
  ask(question);
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    askButton.click();
  }
});

quickPrompts.addEventListener("click", (event) => {
  const prompt = event.target?.dataset?.prompt;
  if (prompt) ask(prompt);
});

// Optional: speech-to-text via the browser's own Web Speech API, when
// available. Entirely client-side, no server/credential involvement --
// purely a nicer input method for a screen recording. Falls back silently
// (button stays present but inert) on unsupported browsers.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognizer = new SpeechRecognition();
  recognizer.lang = "en-US";
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 1;

  let listening = false;
  recognizer.addEventListener("result", (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript;
    if (transcript) questionInput.value = transcript;
  });
  recognizer.addEventListener("end", () => {
    listening = false;
    micButton.classList.remove("active");
  });

  micButton.addEventListener("click", () => {
    if (listening) {
      recognizer.stop();
      return;
    }
    listening = true;
    micButton.classList.add("active");
    setState("listening");
    recognizer.start();
  });
} else {
  micButton.title = "Voice input is not supported in this browser -- type your question instead.";
  micButton.disabled = true;
}
