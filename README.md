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
  * **pTSAsset Reactive Models (`.pts`, `pTSAsset_Data`, `FiniteState_Machine`)**
  * **Function Workflow Pipelines (GitNexus execution chains)**
* Graph Edges represent:
  * **Emits / Triggers**
  * **Listens / Receives**
  * **Instantiates / References / Mutates**

---

### 3.4. Function Workflow Analyzer (`source/engine/FunctionWorkflowAnalyzer.ts`)
* Inspired by the **GitNexus** architecture:
  * Uses TypeScript AST Compiler API to extract method calls, event invokes, and state changes.
  * Identifies **Entry Points** (`onClick`, lifecycle hooks, event listeners).
  * Constructs directed DAG execution pipelines showing step-by-step game feature flows.

---

### 3.5. Interactive Visualizer 2.0 (`static/template/visualizer.html`)
* **Silky Smooth 60 FPS Performance**:
  * **Ego-Graph / Neighborhood Mode**: Default focus on 1-2 hop neighborhood, reducing active canvas nodes from 3,000+ to <50.
  * **Auto-Freeze Barnes-Hut Physics**: Stabilizes in 60 ticks and freezes physics to prevent CPU lag.
  * **Component Aggregation Mode**: Consolidates multiple emits/listens per component into a single card (reducing node count by 70%).
* **Multi-Dimensional Filters**:
  * **View Mode Tabs**: `[All]` `[JsonAsset]` `[pTSAsset]` `[Workflows]`.
  * **Scene & Prefab Scope**: Dropdown to isolate specific scenes (`game.scene`) or prefabs.
  * **Role Toggles**: Toggle Emitters `[⚡]`, Listeners `[🎧]`, Params `[📦]`.
* **Two-Way Editor Synchronization**: Clicking any component or asset immediately focuses that target in the Cocos Creator editor!
* **Standalone HTML Export**: Generates a self-contained HTML file for offline exploration.

---

## 4. Editor Panel & Commands

* Open via **Extension -> pTS Nexus -> Open Event Nexus Graph**.
* **IPC Messages**:

| Message | Description |
|---|---|
| `open-panel` | Opens the dockable Nexus graph window. |
| `scan-network` | Triggers a full AST, pTSAsset, and scene scan to rebuild the network. |
| `generate-html` | Exports the full interactive graph as a standalone HTML file. |

---

## 5. Integration with `pts-core`

* Specifically parses and visualizes communication patterns built with:
  * `pEngine.Json.emit` and `pEngine.Json.on`
  * `Event_Driver` and `Event_Flexer` listeners and handlers
  * `pTSAsset` (`.pts`) data models, state machines, and reactive state mutations
  * Cross-component method call chains and execution workflows

