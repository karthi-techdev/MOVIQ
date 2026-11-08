const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} when downloading from ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          try {
            fs.chmodSync(dest, 0o755);
          } catch {}
          resolve();
        });
      });
      file.on("error", (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }).on("error", reject);
  });
}

async function main() {
  console.log("[install-ytdlp] Setting up yt-dlp and ffmpeg for cinema video streaming...");

  const binDir = path.join(__dirname, "..", "bin");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // 1. Try pip3 / pip install for system Python environment
  const pipCommands = [
    "pip3 install --upgrade --break-system-packages yt-dlp",
    "pip install --upgrade --break-system-packages yt-dlp",
    "pip3 install --upgrade yt-dlp",
    "pip install --upgrade yt-dlp",
    "python3 -m pip install --upgrade yt-dlp",
    "python -m pip install --upgrade yt-dlp"
  ];

  for (const cmd of pipCommands) {
    try {
      execSync(cmd, { stdio: "ignore" });
      console.log(`[install-ytdlp] Successfully installed/updated via: ${cmd.split(" ")[0]}`);
      break;
    } catch {}
  }

  // 2. On Linux (Render cloud hosting), download official standalone Linux yt-dlp binary as guaranteed fallback
  if (process.platform === "linux") {
    const linuxBin = path.join(binDir, "yt-dlp");
    console.log(`[install-ytdlp] Ensuring standalone Linux binary at ${linuxBin}...`);

    let curlSuccess = false;
    try {
      execSync(`curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${linuxBin}" && chmod a+rx "${linuxBin}"`, {
        stdio: "inherit"
      });
      curlSuccess = true;
      console.log("[install-ytdlp] Standalone Linux yt-dlp binary downloaded via curl.");
    } catch (e) {
      console.log("[install-ytdlp] curl failed, using Node https fallback...");
    }

    if (!curlSuccess) {
      try {
        await downloadFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp", linuxBin);
        console.log("[install-ytdlp] Standalone Linux yt-dlp binary downloaded via Node https.");
      } catch (err) {
        console.warn("[install-ytdlp] Warning: Failed to download Linux binary:", err.message);
      }
    }

    // 3. Ensure static ffmpeg binary is available for remuxing separate 1080p video + audio
    const ffmpegBin = path.join(binDir, "ffmpeg");
    let hasFfmpeg = false;
    try {
      execSync("ffmpeg -version", { stdio: "ignore" });
      hasFfmpeg = true;
    } catch {}

    if (!hasFfmpeg && !fs.existsSync(ffmpegBin)) {
      console.log(`[install-ytdlp] Downloading static Linux ffmpeg to ${ffmpegBin}...`);
      try {
        execSync(`curl -fsSL https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/linux-x64 -o "${ffmpegBin}" && chmod a+rx "${ffmpegBin}"`, {
          stdio: "inherit"
        });
        console.log("[install-ytdlp] Static Linux ffmpeg installed successfully!");
      } catch (err) {
        console.warn("[install-ytdlp] ffmpeg download notice:", err.message);
      }
    }
  }

  console.log("[install-ytdlp] Setup complete.");
}

main().catch((err) => {
  console.warn("[install-ytdlp] Setup notice:", err.message);
  process.exit(0);
});
