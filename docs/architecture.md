# Factory Simulation System - アーキテクチャ図

## システム全体構成図

```mermaid
graph TB
    subgraph Browser["ブラウザ (Presentation Layer)"]
        portal[sim-portal<br/>統合ダッシュボード]
        visualizer[sim-visualizer<br/>3D可視化]
        editor[sim-editor<br/>シナリオエディタ]
        executor_ui[sim-executor<br/>実行管理UI]
        factory_mgr[sim-factory-manager<br/>ファクトリ管理]
    end

    subgraph Proxy["API Gateway"]
        nginx[nginx-proxy<br/>:80 / :443]
    end

    subgraph Backend["Backend Services"]
        core[simulation-core<br/>:8080<br/>シミュレーションエンジン]
        gateway[realtime-gateway<br/>:8090<br/>リアルタイムハブ]
        exec_be[sim-executor-backend<br/>:8084<br/>実行管理API]
    end

    subgraph Data["Data Layer"]
        pg[(PostgreSQL<br/>:5432)]
    end

    subgraph External["External"]
        simdb[(SimDB<br/>生産管理DB)]
    end

    portal --> nginx
    visualizer --> nginx
    editor --> nginx
    executor_ui --> nginx
    factory_mgr --> nginx

    nginx -->|/api/scenarios<br/>/api/simulations| core
    nginx -->|/api/factories<br/>/api/data-sources<br/>/ws| gateway
    nginx -->|/api/executor/*| exec_be

    core --> pg
    gateway --> pg
    exec_be --> pg

    gateway -->|POST /run| core
    exec_be -->|POST /api/simulations| core
    exec_be --> simdb

    gateway -.->|WebSocket<br/>リアルタイム配信| visualizer
    pg -.->|NOTIFY| gateway
```

## データフロー図

```mermaid
flowchart LR
    subgraph SimFlow["シミュレーション実行フロー"]
        direction TB
        E1[シナリオ作成<br/>sim-editor] --> E2[シナリオ保存<br/>simulation-core]
        E2 --> E3[初期条件取得<br/>sim-executor-backend]
        E3 --> E4[SimDB問い合わせ]
        E4 --> E5[シミュレーション実行<br/>simulation-core Engine]
        E5 --> E6[結果保存<br/>PostgreSQL]
        E6 --> E7[3D可視化<br/>sim-visualizer]
    end

    subgraph LiveFlow["リアルタイム監視フロー"]
        direction TB
        L1[工場設備] --> L2[SimDB]
        L2 --> L3[WDHテーブル書込<br/>PostgreSQL]
        L3 --> L4[NOTIFY発火]
        L4 --> L5[realtime-gateway<br/>WebSocket Hub]
        L5 --> L6[ブラウザ<br/>3Dリアルタイム表示]
    end
```

## サービス間通信図

```mermaid
sequenceDiagram
    participant U as ユーザー
    participant N as nginx-proxy
    participant C as simulation-core
    participant G as realtime-gateway
    participant X as sim-executor-backend
    participant DB as PostgreSQL
    participant S as SimDB

    Note over U,S: シミュレーション実行フロー
    U->>N: POST /api/executor/execute
    N->>X: Forward
    X->>S: 初期条件取得
    S-->>X: ワークID一覧
    X->>C: POST /api/simulations
    C->>C: Engine.Run()
    C->>DB: ログ保存
    C-->>X: simulationId
    X-->>N: executionId
    N-->>U: 実行完了

    Note over U,S: 結果表示フロー
    U->>N: GET /api/simulations/:id/logs
    N->>C: Forward
    C->>DB: SELECT logs
    DB-->>C: logs
    C-->>N: JSON
    N-->>U: 3D描画データ

    Note over U,S: リアルタイム監視フロー
    U->>N: WebSocket /ws
    N->>G: Upgrade
    G-->>U: Connected
    U->>G: subscribe(dataSourceId)
    DB-->>G: NOTIFY new_event
    G-->>U: event data (JSON)
```

## インフラ構成図

```mermaid
graph LR
    subgraph Docker["Docker Compose"]
        subgraph FE["Frontend Containers (Nginx)"]
            P[sim-portal<br/>/portal/]
            V[sim-visualizer<br/>/visualizer/]
            ED[sim-editor<br/>/editor/]
            EX[sim-executor<br/>/executor/]
            FM[sim-factory-manager<br/>/factory-manager/]
        end

        subgraph BE["Backend Containers (Go)"]
            SC[simulation-core<br/>:8080]
            RG[realtime-gateway<br/>:8090]
            EB[sim-executor-backend<br/>:8084]
        end

        subgraph DB["Database"]
            PG[(postgres:15<br/>:5432)]
        end

        NP[nginx-proxy<br/>:80/:443]
    end

    Client[Client Browser] --> NP
    NP --> P
    NP --> V
    NP --> ED
    NP --> EX
    NP --> FM
    NP --> SC
    NP --> RG
    NP --> EB

    SC --> PG
    RG --> PG
    EB --> PG
```

---

## クラス図

### simulation-core ドメインモデル

```mermaid
classDiagram
    class Scenario {
        +string ID
        +string Name
        +string FactoryID
        +SimDBConfig SimDB
        +[]Station Stations
        +[]Connection Connections
        +time.Time CreatedAt
        +time.Time UpdatedAt
    }

    class Station {
        +string ID
        +StationType Type
        +string Name
        +string ParentID
        +string LocationID
        +float64 PositionX
        +float64 PositionY
        +StationConfig Config
        +[]Port InPorts
        +[]Port OutPorts
        +map~string,bool~ Signals
    }

    class StationType {
        <<enumeration>>
        source
        processing
        drain
        merge
        split
        moduler
        entry
        exit
    }

    class Connection {
        +string From
        +string To
        +RoutingCondition Condition
        +int FromPortIndex
        +int ToPortIndex
    }

    class RoutingCondition {
        <<enumeration>>
        default
        quality_ok
        quality_ng
        workType:*
    }

    class Port {
        +int Index
        +Work CurrentWork
        +bool IsFull
    }

    class Work {
        +string ID
        +QualityStatus Quality
        +string WorkType
        +map~string,any~ Properties
    }

    class QualityStatus {
        <<enumeration>>
        OK
        NG
        未判定
    }

    class InterlockConfig {
        +[]InterlockRule Rules
    }

    class InterlockRule {
        +string TargetSignal
        +bool TargetValue
        +[]RuleCondition Conditions
        +string Logic
    }

    class RuleCondition {
        +string Signal
        +bool Value
        +string StationRef
    }

    class SimDBConfig {
        +string Host
        +int Port
        +string Database
        +string User
        +string Password
    }

    Scenario "1" *-- "*" Station
    Scenario "1" *-- "*" Connection
    Scenario "1" *-- "0..1" SimDBConfig
    Station "1" *-- "*" Port
    Station "1" *-- "0..1" InterlockConfig
    Station -- StationType
    Port "1" o-- "0..1" Work
    Work -- QualityStatus
    Connection -- RoutingCondition
    InterlockConfig "1" *-- "*" InterlockRule
    InterlockRule "1" *-- "*" RuleCondition
```

### simulation-core エンジン

```mermaid
classDiagram
    class Engine {
        +Scenario scenario
        +PriorityQueue eventQueue
        +float64 currentTime
        +[]StationStatusLog statusLogs
        +[]WorkEventLog workEvents
        +[]WorkLineageLog lineageLogs
        +SimDB simDB
        +Run() error
        -processEvent(event)
        -tryTransfer(fromStation, toStation)
        -checkInterlocks(station, signal) bool
    }

    class PriorityQueue {
        +Push(event)
        +Pop() Event
        +Len() int
        +IsEmpty() bool
    }

    class Event {
        +float64 Time
        +EventType Type
        +string StationID
        +string WorkID
        +any Data
    }

    class StationStatusLog {
        +float64 Timestamp
        +string StationID
        +StationState State
        +string SignalName
        +bool Value
    }

    class WorkEventLog {
        +float64 Timestamp
        +string WorkID
        +string StationID
        +WorkEventType EventType
        +int PortIndex
    }

    class WorkEventType {
        <<enumeration>>
        WorkCreated
        WorkArrived
        WorkDeparted
        WorkDestroyed
        WorkMerged
        WorkSplit
    }

    class WorkLineageLog {
        +float64 Timestamp
        +string InputWorkID
        +string OutputWorkID
        +string StationID
    }

    class SimDB {
        +[]InitialWorkCondition GetInitialConditions(startTime)
    }

    class InitialWorkCondition {
        +string WorkID
        +string StationID
        +string WorkType
        +map~string,any~ Properties
    }

    Engine "1" *-- "1" Scenario
    Engine "1" *-- "1" PriorityQueue
    Engine "1" *-- "*" StationStatusLog
    Engine "1" *-- "*" WorkEventLog
    Engine "1" *-- "*" WorkLineageLog
    Engine "1" *-- "0..1" SimDB
    PriorityQueue "1" *-- "*" Event
    WorkEventLog -- WorkEventType
    SimDB ..> InitialWorkCondition
```

### realtime-gateway

```mermaid
classDiagram
    class Handler {
        +Repository repo
        +Hub wsHub
        +string simulationCoreURL
        +HandleFactories(w, r)
        +HandleDataSources(w, r)
        +HandleExecutions(w, r)
        +HandleWebSocket(w, r)
    }

    class Repository {
        +*sql.DB db
        +ListFactories() []Factory
        +GetFactory(id) Factory
        +CreateFactory(f) Factory
        +UpdateFactory(f) error
        +DeleteFactory(id) error
        +ListDataSources() []DataSource
        +GetDataSource(id) DataSource
        +CreateDataSource(ds) DataSource
        +DeleteDataSource(id) error
        +GetLayout(dsId) Layout
        +GetEvents(dsId, from, to) []EventRecord
    }

    class Factory {
        +string ID
        +string Name
        +string Description
        +string DBHost
        +int DBPort
        +string DBName
        +time.Time CreatedAt
    }

    class FactoryStation {
        +string ID
        +string FactoryID
        +string StationID
        +string EquipmentID
        +string Name
        +string StationType
        +float64 PositionX
        +float64 PositionY
        +json.RawMessage Config
    }

    class DataSource {
        +string ID
        +string SourceType
        +string ScenarioID
        +string FriendlyName
        +time.Time StartedAt
        +*time.Time EndedAt
        +json.RawMessage Config
    }

    class Hub {
        +map~string,*Client~ clients
        +Register(client)
        +Unregister(client)
        +Broadcast(dataSourceId, message)
    }

    class NotifyListener {
        +*pgx.Conn conn
        +Hub hub
        +Listen()
        -onNotification(payload)
    }

    Handler "1" *-- "1" Repository
    Handler "1" *-- "1" Hub
    Repository ..> Factory
    Repository ..> FactoryStation
    Repository ..> DataSource
    Hub "1" *-- "*" Client
    NotifyListener "1" --> "1" Hub
    Factory "1" *-- "*" FactoryStation
```

### sim-visualizer フロントエンド

```mermaid
classDiagram
    class App {
        +Visualizer3D visualizer
        +Object logs
        +number currentTime
        +number maxTime
        +boolean isPlaying
        +number speed
        +Map flatScenario
        +Map modulerMap
        +Set _drainIds
        +Map _rawActiveWorks
        +boolean _showInternal
        -_init()
        -_initDataSource(dsId, liveMode)
        -_buildLayer1Scenario(flatScenario)
        -_flattenScenario(scenario)
        -_transformForLayer1(rawActiveWorks)
        -_transformForInternalView(rawActiveWorks)
        -_updateSimulation()
        -_refreshWorks()
    }

    class Visualizer3D {
        +HTMLElement container
        +THREE.Scene scene
        +THREE.Camera camera
        +THREE.Renderer renderer
        +OrbitControls controls
        +Map stations
        +Map works
        +Array connections
        +boolean showWorkIDs
        +boolean showStationNames
        +boolean showInterlocks
        +boolean showInternal
        +Map _internalPositions
        +loadScenario(scenario)
        +loadInternalStations(flatScenario)
        +updateWorks(activeWorks, currentTime)
        +updateInterlockStates(signalStates)
        +setShowInternal(show)
        +setShowInternalNames(show)
        -_createStation(station, pos)
        -_createModulerGridModel(id, station, pos)
        -_buildShellGeometry(cells, cellSize, h, refC, refR)
        -_createConnection(from, to, condition)
        -_rerouteConnections()
    }

    class LiveClient {
        +string wsUrl
        +string dataSourceId
        +WebSocket ws
        +LiveMode mode
        +connect()
        +subscribe(dataSourceId)
        +disconnect()
        +onEvent(callback)
        +onLayoutUpdate(callback)
    }

    class LiveMode {
        <<enumeration>>
        SNAPSHOT
        STREAM
    }

    class MouseConfig {
        +string preset
        +Object bindings
        +save()
        +load()
        +onChange(callback)
    }

    App "1" *-- "1" Visualizer3D
    App "1" *-- "0..1" LiveClient
    App "1" *-- "0..1" MouseConfig
    LiveClient -- LiveMode
```

### sim-editor フロントエンド

```mermaid
classDiagram
    class ScenarioEditor {
        +Canvas canvas
        +PropertiesPanel properties
        +CommandManager commands
        +ModelEditor modelEditor
        +MenuBar menuBar
        +Minimap minimap
        +Object scenario
        +Array _editStack
        +string _editMode
        +load(scenarioId)
        +save()
        +drillDown(stationId)
        +drillUp()
        +setEditMode(mode)
        -_addStation(type, x, y)
        -_deleteStation(id)
        -_addConnection(from, to)
        -_updateStation(id, props)
    }

    class Canvas {
        +SVGElement svg
        +number zoom
        +number panX
        +number panY
        +Set selectedStations
        +drawStation(station)
        +drawConnection(from, to, condition)
        +updateStationPosition(id, x, y)
        +selectStation(id)
        +clearSelection()
        +pan(dx, dy)
        +setZoom(scale)
    }

    class CommandManager {
        +Array undoStack
        +Array redoStack
        +execute(command)
        +undo()
        +redo()
        +canUndo() bool
        +canRedo() bool
    }

    class Command {
        <<interface>>
        +execute()
        +undo()
    }

    class AddStationCommand {
        +execute()
        +undo()
    }

    class DeleteStationCommand {
        +execute()
        +undo()
    }

    class MoveStationCommand {
        +execute()
        +undo()
    }

    class AddConnectionCommand {
        +execute()
        +undo()
    }

    class PropertiesPanel {
        +show(station)
        +hide()
        +getValues() Object
    }

    class ModelEditor {
        +HTMLCanvasElement canvas
        +Array cells
        +number gridSize
        +number height
        +open(model3DGrid)
        +close()
        +getModel3DGrid() Object
        -_drawGrid()
        -_drawCells()
        -_handleMouseDown(e)
        -_handleMouseMove(e)
    }

    class Clipboard {
        +copy(stations, connections)
        +paste(offsetX, offsetY)
        +hasCopied() bool
    }

    class Editor3DView {
        +HTMLCanvasElement canvas
        +show(scenario)
        +hide()
        -_build(scenario)
        -_addStation(scene, station, px, pz, scale)
        -_buildShellGeometry(cells, cellSize, h, refC, refR)
    }

    ScenarioEditor "1" *-- "1" Canvas
    ScenarioEditor "1" *-- "1" CommandManager
    ScenarioEditor "1" *-- "1" PropertiesPanel
    ScenarioEditor "1" *-- "1" ModelEditor
    ScenarioEditor "1" *-- "1" Clipboard
    ScenarioEditor "1" *-- "0..1" Editor3DView
    CommandManager "1" *-- "*" Command
    Command <|.. AddStationCommand
    Command <|.. DeleteStationCommand
    Command <|.. MoveStationCommand
    Command <|.. AddConnectionCommand
```

### データベーススキーマ (ER図)

```mermaid
erDiagram
    factories ||--o{ factory_stations : has
    factories ||--o{ factory_connections : has
    factories ||--o{ scenarios : belongs_to

    scenarios ||--o{ scenario_stations : contains
    scenarios ||--o{ scenario_connections : contains
    scenarios ||--o{ data_sources : produces

    data_sources ||--o{ location_master : snapshot
    data_sources ||--o{ connection_master : snapshot
    data_sources ||--o{ item_movement : events
    data_sources ||--o{ item_lineage : traceability
    data_sources ||--o{ item_status : state

    data_sources ||--o{ execution_configs : executed_by

    factories {
        uuid id PK
        string name
        string description
        string factory_db_host
        int factory_db_port
        string factory_db_name
        timestamp created_at
    }

    factory_stations {
        bigint id PK
        uuid factory_id FK
        string station_id UK
        string equipment_id
        int seq_number
        string name
        string station_type
        float position_x
        float position_y
        jsonb config
    }

    factory_connections {
        bigint id PK
        uuid factory_id FK
        string from_station
        string to_station
        string condition
        int from_port_index
        int to_port_index
    }

    scenarios {
        bigint id PK
        string name
        uuid factory_id FK
        string scenario_type
        string simdb_host
        int simdb_port
        string simdb_database
        timestamp created_at
        timestamp updated_at
    }

    scenario_stations {
        bigint id PK
        bigint scenario_id FK
        string station_id
        string station_type
        string parent_id
        string location_id
        string override_type
        jsonb config
    }

    scenario_connections {
        bigint id PK
        bigint scenario_id FK
        string from_station
        string to_station
        string condition
        int from_port_index
        int to_port_index
    }

    data_sources {
        uuid id PK
        string source_type
        bigint scenario_id FK
        string friendly_name
        timestamp started_at
        timestamp ended_at
        jsonb config
    }

    execution_configs {
        uuid id PK
        bigint scenario_id FK
        uuid data_source_id FK
        float start_time
        string end_condition_type
        float end_condition_value
        jsonb initial_conditions
        string status
        timestamp created_at
    }

    location_master {
        bigint id PK
        uuid data_source_id FK
        string name
        string station_type
        bigint parent_location_id
        float pos_x
        float pos_y
    }

    connection_master {
        bigint id PK
        uuid data_source_id FK
        bigint from_location_id FK
        bigint to_location_id FK
        string condition
        int from_port_index
        int to_port_index
    }

    item_movement {
        timestamp event_time
        uuid data_source_id FK
        string item_id
        bigint from_location_id
        bigint to_location_id
        string movement_type
        int port_index
    }

    item_lineage {
        timestamp event_time
        uuid data_source_id FK
        string input_item_id
        string output_item_id
        bigint location_id
    }

    item_status {
        timestamp event_time
        uuid data_source_id FK
        string item_id
        jsonb status
    }
```

### シグナルシステム

```mermaid
classDiagram
    class StationSignals {
        +bool inputWorkPresent      // ワークが搬入位置にある
        +bool processingWorkPresent // ワークが加工位置にある
        +bool outputWorkPresent     // ワークが搬出位置にある
        +bool running
        +bool complete
        +bool processReady
        +bool inputReady
        +bool outputReady
        +bool workFull
        +bool workEmpty
    }

    class MergeSignals {
        +bool allPortsFull
        +bool allPortsEmpty
        +bool port0Full
        +bool port0Empty
        +bool port0HasWork
        +bool port1Full
        +bool port1Empty
        +bool port1HasWork
    }

    class SplitSignals {
        +bool allPortsFull
        +bool allPortsEmpty
        +bool port0Full
        +bool port0Empty
        +bool port1Full
        +bool port1Empty
    }

    class InterlockEngine {
        +evaluateRules(station, scenario) map~string,bool~
        -checkCondition(cond, signals) bool
        -resolveStationRef(ref, scenario) Station
    }

    StationSignals <|-- MergeSignals
    StationSignals <|-- SplitSignals
    InterlockEngine ..> StationSignals : evaluates
```
