# `pts-nexus` - Event & Architecture Nexus Visualizer

> **Author**: pTSern  
> **Version**: `1.0.0`  
> **Cocos Creator Compatibility**: `>= 3.8.0`  
> **Category**: Developer Tools, Static Analysis & Visualizer

---

## 1. Overview

`pts-nexus` is an architecture visualization and dependency analysis engine for Cocos Creator. In large game codebases utilizing decoupled event architectures (`pEngine.Json`, `pDriver`, `Event_Driver`), tracing which component fires an event, which nodes listen to it, and what parameters are passed across scenes and prefabs becomes challenging.

`pts-nexus` performs **TypeScript AST (Abstract Syntax Tree) code analysis** combined with **Scene and Prefab graph scanning** to construct a live, interactive topological map of all events, senders, listeners, and data models across the entire project.

---

## 2. Process Architecture & Topology

```
┌─────────────────────────────────────────────────────────────┐
│                  Analysis Pipeline (Main Process)           │
│                                                             │
│  ┌──────────────────────┐         ┌──────────────────────┐  │
│  │ TypeScript AST Engine│         │ Scene & Prefab Scan  │  │
│  │ (AST code parser)    │         │ (JSON hierarchy scan)│  │
│  └──────────┬───────────┘         └──────────┬───────────┘  │
│             │                                │              │
│             ▼                                ▼              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ NexusGraphBuilder & TypeRegistry                      │  │
│  │ Correlates: Components ◄──► Events ◄──► Handlers     │  │
│  └──────────────────────────┬────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Interactive Visualizer UI                   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Dockable Editor Panel (`source/panel.ts`)             │  │
│  │ - Embedded interactive network graph (IFrame)         │  │
│  │ - Color-coded event clusters & signal pathways        │  │
│  │ - One-click editor focus (`focusTargetInEditor`)      │  │
│  │ - Standalone HTML export (`generate-html`)            │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Core Engine Components

### 3.1. TypeScript AST Analyzer (`source/engine/TypeScriptAstAnalyzer.ts`)
* Uses TypeScript Compiler API to analyze source code without running it:
  * Detects `@ccclass` decorators and class inheritance.
  * Identifies event subscriptions: `.on(EventName, callback)`.
  * Identifies event dispatches: `.emit(EventName, payload)`.
  * Extracts payload schemas and parameter signatures.

---

### 3.2. Scene & Prefab Scanner (`source/engine/ScenePrefabScanner.ts`)
* Scans all `.scene` and `.prefab` assets in the project.
* Maps component instances attached to scene nodes to their underlying TypeScript definitions.
* Links serialized inspector properties (e.g. assigned handlers or targets) directly into the graph.

---

### 3.3. Graph Topology Builder (`source/engine/NexusGraphBuilder.ts`)
* Correlates AST code nodes with scene/prefab instances.
* Graph Nodes represent:
  * **Scenes & Prefabs**
  * **Component Scripts**
  * **Event Channels (`pEngine.Json`)**
  * **pTSAsset Data Models**
* Graph Edges represent:
  * **Emits / Triggers**
  * **Listens / Receives**
  * **Instantiates / References**

---

### 3.4. Interactive Visualizer (`source/template/visualizer.html.ts`)
* Renders the generated graph inside a hardware-accelerated interactive canvas.
* **Search & Filter**: Search by event name, class name, or node path.
* **Cluster Grouping**: Groups nodes by subsystem (e.g. Battle, Lobby, Audio, UI, Storage).
* **Two-Way Editor Synchronization**: Clicking any component node in the visualizer immediately selects and focuses that node or asset in the Cocos Creator editor!
* **Standalone HTML Export**: Generates a self-contained HTML file for documentation and team architecture reviews.

---

## 4. Editor Panel & Commands

* Open via **Extension -> pTS Nexus -> Open Event Nexus Graph**.
* **IPC Messages**:

| Message | Description |
|---|---|
| `open-panel` | Opens the dockable Nexus graph window. |
| `scan-network` | Triggers a full AST and scene scan to rebuild the dependency network. |
| `generate-html` | Exports the full interactive graph as a standalone HTML file. |

---

## 5. Integration with `pts-core`

* Specifically parses and visualizes communication patterns built with:
  * `pEngine.Json.emit` and `pEngine.Json.on`
  * `Event_Driver` event listeners and handlers
  * `pTSAsset` data injection flows
