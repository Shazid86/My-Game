# 🧟 Graveyard Shift — Master Development Roadmap & Technical Spec

This document outlines the architectural roadmap for **Graveyard Shift**. The project is engineered around three core pillars: **Ultra Mobile Optimization**, **Offline-First Availability**, and **High-Performance 60 FPS Canvas Rendering**.

---

## ⚡ Core Technical Guiding Principles

* 📱 **Mobile-First Ergonomics**: All UI elements, touch joysticks, and modal dialogs are designed specifically for thumb accessibility and responsive scaling across mobile screen sizes.
* 🚀 **Extreme Performance Optimization**: Zero memory leaks, capped canvas sprite counts, lightweight math loops, and object pooling to guarantee smooth 60 FPS gameplay on low-to-mid-tier smartphones.
* 📶 **Offline-First PWA Architecture**: Built with Service Worker caching (`sw.js`) and local assets so the entire game loads instantaneously and remains 100% playable without an active internet connection.

---

## 📌 Development Phase Overview

---

## 🛠️ Phase 1: Version 1.0.1 — Immediate QoL, Offline PWA & Bugfixes

### 1. Offline Service Worker & Manifest Calibration
* **Feature**: Full offline play capability.
* **Details**: Implement a lightweight Service Worker (`sw.js`) to cache static assets, audio files, and script bundles. Ensure the app opens instantly offline from the home screen icon.
* **Optimization Goal**: Zero network fetch requirement after first launch.

### 2. Pause Menu Mobile Scaling
* **Problem**: Modal overlay is too wide on narrow landscape displays.
* **Solution**: Recalculate container bounds with mobile viewports in mind (`max-w-md` on mobile landscape) to keep the action behind the menu visible.

### 3. Endless Mode State Persistence
* **Feature**: Suspend and resume game sessions.
* **Details**: Add "Save & Exit" during Endless Mode. Persist active score, kills, wave progression, and weapon inventory to browser `localStorage` (`gs-endless-save`).

### 4. Auto-Reload System Calibration
* **Bug Fix**: Firearms occasionally lock up when ammo hits 0 without auto-reloading.
* **Details**: Enforce an automated check in the firing loop: if `clipAmmo === 0 && !isReloading`, trigger `startReload()` immediately across all weapon types.

### 5. Bomb Trajectory & Recharge Indicator
* **Feature**: Visual targeting line and HUD refill timer.
* **Details**: Render a dashed vector trajectory toward the landing spot. Add a 15–30 second recharge timer with a radial ring progress indicator directly on the BOMB button.

---

## 🕯️ Phase 2: Version 1.1 — Visual Atmosphere, Lighting & World Design

### 1. Mobile-Optimized 2D Lighting Engine
* **Feature**: Survival horror dark atmosphere using hardware-accelerated canvas compositing.
* **Details**:
  * Render a dark ambient layer (`rgba(0,0,0,0.85)`).
  * Use lightweight `destination-out` radial blending to carve out the player's flashlight cone and weapon muzzle flashes.
* **Optimization Goal**: Capped at 1 lighting render pass per frame to avoid mobile GPU overhead.

### 2. Environmental Obstacles & Cover
* **Feature**: Dynamic map objects for tactical maneuvering.
* **Details**: Add gravestones, wooden crates, and rusted vehicles with lightweight circular/AABB collision hitboxes.

---

## ⚔️ Phase 3: Version 1.2 — Boss Battles & Meta Progression

### 1. Boss Encounters
* **Feature**: Mega-zombie waves every 5 waves (e.g., *Brute Zombie* with ground stuns, *Spitter Zombie* with ranged acid).
* **UI**: Top HUD boss health indicator optimized for mobile viewports.

### 2. Weapon Shop & Meta Upgrades
* **Feature**: Persistent progression system.
* **Details**: Collect "Zombie DNA" currency per kill to upgrade Fire Rate, Clip Size, Reload Speed, and Explosive Radius between runs.

---

## 🌐 Phase 4: Version 2.0 — Real-Time Multiplayer & Customization

### 1. Co-Op Multiplayer
* **Architecture**: WebSocket / Socket.io server layer with client-side prediction and server reconciliation for smooth multiplayer on mobile networks.

### 2. Character Skins & Cosmetics
* **Details**: Unlockable player skins, hat accessories, and custom weapon muzzle trails.

---

## 📋 Optimization & QA Checklist

- [ ] **Offline PWA**: Game opens and plays in Flight Mode / Airplane Mode with zero internet connectivity.
- [ ] **Frame Rate**: Maintains stable 60 FPS on mobile hardware during high zombie density waves.
- [ ] **Touch Controls**: Joysticks respond without touch input ghosting or gesture delays.
- [ ] **Memory Footprint**: Active garbage collection keeps memory usage under 150 MB.