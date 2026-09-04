# Virtual list パフォーマンス規約

このディレクトリには、仮想カードリストの実装が含まれている。このコードを最適化する際は、測定結果（データ）に基づいて行うこと。以下に定義する規約を維持し、改善を行う際はワークロードを記録し、状態の変更（ミューテーション）は局所的に留めること。

## ワークロードの測定条件（Workload Dimensions）

virtual listのパフォーマンスコストは、Vault（データ全体）の総サイズよりも、主に「単一のvirtual list内にレンダリングされるカードや行の数」と「同時に存在するスクロールコンテナの数」に依存する。1つのスクロールコンテナには、activeなvirtual list subscriberを最大1つだけ持たせる。パフォーマンスが重要となるコード（ホットパス）を変更する場合は、少なくとも以下の指標を記録すること。

| 指標（Dimension）      | ベースライン・マトリクス                                 |
| ---------------------- | -------------------------------------------------------- |
| `cardCount`            | `100`, `1_000`, `10_000`                                 |
| `scrollerCount`        | `1`, `8`, `32`                                           |
| `viewportRows`         | テストしたカードレイアウトでの実際の表示行数             |
| `mountedRows`          | ビューポートの行数 ＋ マウント済みのオーバースキャン行数 |
| `scrollFrames`         | `300` 連続フレーム                                       |
| 構造のミューテーション | なし、active list内、スクロール祖先の変更                |

Vault全体のベンチマークは、インデックス作成レイヤーやE2E（エンドツーエンド）テストレイヤーで行うこと。実際のVaultでvirtual listの変更をテストする場合は、合計ファイル数（例：`1_000`、`10_000`、`50_000` ファイル）を別途記録すること。

現状では、以下に挙げるすべてのキャッシュの有効性を証明できるような、正確なカード数のしきい値は記録されていない。これらのしきい値を推測で設定しないこと。キャッシュを変更または削除する場合は測定を実施し、観察された損益分岐点（ブレークイーブンポイント）を明記すること。

## 必須の不変条件（Required Invariants）

- マウントされるDOM要素の数は、全体の `cardCount` ではなく「マウント範囲」によって制限されること。
- `physicalCellSlot` は、単一のマウント済みスナップショット内で一意であること。
- 保持された論理セルは、レイアウトとphysical slot poolのepochが再利用可能な場合、そのレンダースロットを維持すること。
- physical row/cell slot は `physicalRowSlot` / `physicalCellSlot` の数値だけを所有し、logical key と分離する。row が別の physical slot に移動した場合だけ physical binding を更新する。
- mounted build の正規表現は `rowsInMountedRange` とし、同じbindingを平坦化した配列は保持しない。平坦な走査が必要なconsumerはrowの `bindings` をその場で走査する。
- `previewVisible` は、 `mounted` の範囲を超えて拡張されないこと。
- スクロールの測定値は、スクロールのフラッシュごとに1回だけ読み取られ、activeなsubscriberに渡されること。
- 構造のミューテーションは、同じスクロールコンテナのactive subscriberだけを更新し、他のスクロールコンテナのsubscriberを測定しないこと。
- active subscriberに影響する構造のミューテーションは、スクロールコンテナのキャッシュを無効化すること。
- 公開されたスナップショットやビルド結果は、返された後は厳密に immutable として扱われること。

two-hop surface も同じ不変条件に従う。section margin、header、load-more、複数列の配置は `TwoHopRowModel` が表現し、DOM residency は shared engine の `mounted` 範囲と resident slot pool だけで決める。section の materialized prefix やスクロール履歴を理由に、row/cell shell を追加保持してはならない。card model の off-window cache は `TwoHopCardHydrator` 内で最大 `64` 件に制限する。

振る舞いのテストは、実装と同じ場所に配置されている。パフォーマンステストでは実行時間のしきい値ではなく、関数呼び出し回数やスパイカウンターを使用すること。

## キャッシュ一覧（Cache Inventory）

### Shared Frame Scroll Metrics

場所: `src/cards/virtualization/viewport/observer/scrollerRegistry.ts`, `src/cards/virtualization/viewport/measurement.ts`

- **目的:** フレームごとにスクロールメトリクスを1回読み取り、スケジュールされたその測定中にactive subscriberへ渡す。
- **スコープ:** element scroller または `Window` をキーにした `ScrollerViewportEntry` 1つにつき1件。同じ scroller の active subscriber は最大1件。
- **無効化:** スクロールのフラッシュごとに新しく読み取られ、最終的なクリーンアップ時に保留状態がクリアされる。

### Flat Grid Runtime Memo

場所: `src/cards/grid/runtime/flat-grid/modelMemo.ts`

- **目的:** 依存関係に変更がない限り、再評価をまたいでも論理セルのソースと行モデルの同一性を安定して維持する。
- **スコープ:** フックインスタンスごとに1つの論理ソースエントリと1つの行モデルエントリ。
- **無効化:** コンテンツリビジョン、item ID リビジョン、表示可能なページネーション形状、またはグリッドレイアウトキーの変更。
- **item ID 契約:** `getItemId` は同一ソース内で一意かつ、並べ替え・filter・index 移動を跨いで安定していなければならない。index は identity に含めない。
- **呼び出し元の責任:** items配列がインプレース（破壊的）で変更された場合、呼び出し元は `itemsRevision` を更新しなければならない。リゾルバ関数の同一性を変えずに item ID の解決動作が変わる場合、呼び出し元は `itemIdRevision` を更新しなければならない。

### Engine Snapshot Fast Paths

場所: `src/cards/virtualization/engine/snapshotComputation.ts`, `src/cards/virtualization/engine/virtualizer.ts`

- **目的:** 行モデルの同一性、マウント範囲、全体の高さが再利用を許容する場合、マウントされたセルの再構築をスキップする。
- **スコープ:** 次のエンジン計算に渡される以前のスナップショット。
- **無効化:** 選択されたファストパスによって宣言された依存関係のいずれかの変更。
- **制限事項:** 可視性メタデータを管理する呼び出し元は、新しい `previewVisible` 範囲を出力しながら、マウントされたセルを再利用する可能性がある。呼び出し元は自身の可視性状態を更新する責任がある。
- **所有権:** no-op時のsnapshot/build再利用判定はengineだけが所有する。下位のmounted-row builderは同じ範囲判定を重複させず、範囲のclampはshared row builderに委譲する。

### Physical Grid Slot Signals

場所: `src/cards/grid/surface/physicalGridSlotPool.svelte.ts`

- **目的:** immutableなmounted buildを、physical row/cellごとの独立したSvelte signalへ反映し、通常スクロール時にresident row全体の`{#each}` reconciliationを発生させない。
- **スコープ:** `PooledCardGridRows`インスタンスごとに1つ。row/cell shellはphysical slot capacityのhigh-water markまで保持する。
- **更新:** 同じmounted rowオブジェクトを保持するslotにはsignalを書き込まない。reboundしたrowだけがrow metadataと各column bindingを更新する。
- **入力順:** mounted buildは論理行順の`rowsInMountedRange`を直接渡す。poolが`physicalRowSlot`で宛先を解決するため、physical slot順への並べ替え配列は作らない。
- **構造変更:** capacity増加時だけrow配列を拡張し、columns変更時だけrow/cell topologyを再構築する。range縮小で非activeになったslotはshellを保持し、bindingだけを解除する。
- **所有権:** virtualizerのsnapshot/buildはimmutableのまま維持し、局所的なミューテーションはsurface-owned slot signalだけが所有する。

## Mutation Ownership

- `VirtualListSnapshot` およびすべてのビルド結果は、高速な構築のために内部型がミューテーションを許可している場合でも、公開された後は厳密に読み取り専用となる。
- リコンシリエーション（差分調整）ビルダーは、新しく割り当てられた配列やマップを返す前にミューテーションすることが可能である。ただし、以前に公開されたビルドは **絶対に** ミューテーションしてはならない。
- `ScrollerViewportEntry` は、単一のactive subscriber、保留中の測定フラグ、依存オブザーバー、およびスクロールフェーズフラグを所有・管理する。
- スクロール中の後処理フラグは `src/cards/virtualization/viewport/observer/scrollerRegistry.ts` の scroller entry が所有し、`src/cards/virtualization/viewport/observer/scrollMeasurement.ts` の scroll start/idle で遷移させる。structure observer は購読中接続したままにし、scroll 中は dependency refresh と layout measurement の dirty flag だけを立てる。
- 構造ミューテーションを無視するためのセレクターは `src/cards/virtualization/viewport/observer/observerDependencies.ts` に定義されている。無視されたミューテーションは意図的にレイアウト計算を抑制するため、新しい無視ルールを追加する際は必ず固有のテストを追加すること。

## 測定チェックリスト（Measurement Checklist）

パフォーマンスに影響を与える重要なホットパスを変更する場合は、少なくとも以下のデータを取得すること。

- カード数が `100`、`1_000`、`10_000` のときのマウントされたDOMノード数。
- No-op（実質的な変更なし）の測定時における、マウントされたセルのビルド数。
- `300` スクロールフレームにわたる `32` スクロールコンテナでのスクロールメトリクスの読み取り回数。
- active list内および別スクロールコンテナ上の構造ミューテーション時における、スケジュールされたレイアウト測定の回数。
- 変更したキャッシュにおける、キャッシュのヒット数、ミス数、無効化数、および破棄（エビクション）数。

現状、すべてのキャッシュにデバッグカウンターが実装されているわけではない。キャッシュのチューニングを行う際は、本番環境のパフォーマンスに影響を与えないよう、既存のデバッグフラグの背後に診断用カウンターを追加すること。
