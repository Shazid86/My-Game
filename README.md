# 🧟‍♂️ Graveyard Shift — Zombie Survival Shooter

**Graveyard Shift** is a fast-paced, high-intensity 2D top-down action shooter built for both Mobile and Desktop browsers. Face relentless waves of zombie hordes across an expanded arena, unlock powerful long-range and short-range weapons, throw high-yield AoE explosives, and set personal survival records.

Fully equipped with **Progressive Web App (PWA)** capabilities, you can install the game directly onto your Android or iOS device to play in a borderless, full-screen landscape experience.

---

## 🌟 Key Features

* 📱 **Native Mobile Experience (PWA Support)**: Install directly to your home screen via Chrome/Safari for a 100% full-screen, app-like feel with zero browser bars.
* 🗺️ **Expanded Bounded Arena**: Explore a massive world (~2.2x viewport scale) with smooth camera tracking and lightweight off-screen threat indicators.
* ⚔️ **Dual Game Modes**:
  * **Survival Mode**: Classic permadeath challenge across three difficulties (**Easy**, **Medium**, **Hard**). Test your skill and push your high score limits.
  * **Endless / Casual Mode**: Low-stress sandbox action. When health hits 0, a **3-second auto-respawn countdown** brings you right back into the match without a game over.
* 🔫 **Balanced Weapon Arsenal**:
  * **Long-Range Weapons**: Precision firearms (e.g., *M9 Sidearm*, *Interceptor*) tuned for sniping incoming threats from afar.
  * **Short-Range Weapons**: Heavy close-quarters tools (e.g., *Saw*, *Flamethrower*) designed for instant point-blank wave shredding.
* ⚡ **Auto-Reload System**: Seamless, fast auto-reload triggers immediately when your clip runs out so you never stop firing.
* 💣 **AoE Bomb Mechanic**: Directional, impact-detonated explosives designed to clear massive zombie crowds instantly with zero self-damage.
* 📊 **Persistent High Scores**: Personal records for **Total Kills** and **Max Survival Time** are stored locally (`gs-records`) per mode and difficulty level.

---

## 📲 How to Install as a Mobile App

You can run **Graveyard Shift** like a native mobile app without downloading an `.apk` or using an app store:

### Android (Google Chrome)
1. Open the game link in **Google Chrome**.
2. Tap the **3-dot menu** in the top-right corner.
3. Select **"Add to Home screen"** or **"Install App"**.
4. Confirm by tapping **Add**. 
5. Launch the game directly from your home screen icon for full-screen, borderless play.

### iOS (Apple Safari)
1. Open the game link in **Apple Safari**.
2. Tap the **Share button** (square with an upward arrow) at the bottom.
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **Add** in the top right.
5. Launch the game from your home screen icon for a full landscape display.

---

## 🎮 How to Play & Controls

### Mobile Touch Controls
| Action | Mobile Input |
| :--- | :--- |
| **Movement** | Drag the **Left Virtual Joystick** (`MOVE`) |
| **Aim & Shoot** | Drag/Hold the **Right Virtual Joystick** (`AIM + FIRE`) |
| **Throw Bomb** | Tap the **BOMB** button |
| **Swap Weapon** | Tap the **SWAP** button |
| **Dash / Evasion** | Tap the **DASH** button |

### Desktop Keyboard & Mouse
| Action | Key / Mouse Input |
| :--- | :--- |
| **Movement** | `W`, `A`, `S`, `D` or Arrow Keys |
| **Aim** | Mouse Pointer |
| **Fire** | Left Mouse Click / Hold |
| **Throw Bomb** | `G` or On-Screen Bomb Button |
| **Swap Weapon** | `Q` or Number Keys (`1`–`6`) |
| **Dash** | `Spacebar` or `Shift` |

---

## 🛠️ Tech Stack & Architecture

* **Framework**: [Next.js](https://nextjs.org/) / React
* **Language**: TypeScript
* **Game Engine**: Custom Canvas-based 2D Render Loop
* **Styling**: Tailwind CSS
* **Persistence**: Browser `localStorage` (`gs-records`)
* **PWA & Manifest**: Custom `manifest.json` configured for `"display": "standalone"` and `"orientation": "landscape"`

---

## 🚀 Local Development Setup

Follow these steps to run the game locally on your machine:

1. **Clone the repository**:
   ```bash
   git clone [https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git](https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git)
   cd YOUR_REPO_NAME

  
2. Install dependencies:
Bash:
npm install

3. Start the local development server:
Bash:
npm run dev

4. Open in Browser:
Navigate to http://localhost:5173 to play and test locally.

📄 License
This project is licensed under the MIT License — feel free to modify, distribute, and build upon it!
