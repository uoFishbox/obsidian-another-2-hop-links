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
- `renderSlotIndex` は、単一のマウント済みスナップショット内で一意であること。
- 保持された論理セルは、レイアウトが再利用可能な場合、そのレンダースロットを維持すること。
- `previewVisible` は、 `mounted` の範囲を超えて拡張されないこと。
- スクロールの測定値は、スクロールのフラッシュごとに1回だけ読み取られ、activeなsubscriberに渡されること。
- 構造のミューテーションは、同じスクロールコンテナのactive subscriberだけを更新し、他のスクロールコンテナのsubscriberを測定しないこと。
- active subscriberに影響する構造のミューテーションは、スクロールコンテナのキャッシュを無効化すること。
- 公開されたスナップショットやビルド結果は、返された後は厳密に immutable として扱われること。

振る舞いのテストは、実装と同じ場所に配置されている。パフォーマンステストでは実行時間のしきい値ではなく、関数呼び出し回数やスパイカウンターを使用すること。

### Two-hop keyed pooled surface

`TwoHopSurface.svelte` は共有 `VirtualSurface` のphysical row/cell shellとカードbodyを再利用する。

- physical row/cell shellには位置とslot identityだけを保持する。
- itemの `renderBodyKey` はphysical slot keyと一致させ、別カードへのrebindでもcard componentを維持する。
- resident windowが同一ならmounted-row buildを同一参照で返し、Svelte state commitとDOM writeを行わない。
- preview候補とrow visibility deltaはsurface所有の`VirtualPreviewSurface`で同期し、`ViewItemCard`は物理slot IDだけを`PreviewHost`へ渡す。
- item interaction descriptorはphysical slot単位のresolver providerへ同期し、rebind時はentry内容だけを更新する。headerはlogical component lifecycleを使う。
- load-more bodyは通常のbutton lifecycleを使い、クリック中に同じbodyを別カードへ書き換えない。
- `TwoHopDocument` と固定grid geometryは全カード分のDOMやcell objectを生成せず、mounted rangeだけをmaterializeする。

契約テストは `features/two-hop/ui/__tests__/TwoHopSurface.svelte.dom.test.ts` と `twoHopMountedRows.test.ts` に置く。`100`/`1,000`/`10,000` cardsと別scroller上の`1`/`8`/`32` surfacesでDOM数がboundedであること、physical slot再利用時にbody keyが変わること、resident hitでbuild identityを維持すること、load-more bodyが新しいlogical cardへremountされることを検証する。

## キャッシュ一覧（Cache Inventory）

### 直近のスクロールコンテナ（Nearest Scroll Container）

場所: `dom/scrollContainer.ts`

- **目的:** 繰り返しのDOMツリー走査や `getComputedStyle()` の呼び出しを防ぐ。
- **スコープ:** virtual listのルート要素ごとに1つの `WeakMap` エントリ。
- **依存関係:** ルートの親、ルートノード、およびキャッシュされたスクロールの祖先。
- **無効化:** ルート要素のリサイズ、グローバルな構造ミューテーション、ナビゲーションスクロール、サブスクライバーのクリーンアップ、およびスクロールコンテナの階層を変更するその他の操作。

### Shared Card Grid Layout

場所: `dom/virtualListCardLayout.ts`

- **目的:** repeated layout measurement間で、派生したカードグリッドのジオメトリを再利用し、安定したオブジェクトの同一性を維持する。
- **スコープ:** スクロールコンテナまたはフォールバックレイアウトルートごとに1つの制限付きマップ。
- **依存関係:** リストの種類、コンテナの幅、レイアウトシグネチャ。
- **破棄（エビクション）:** ルートのマップが `48` エントリに達した場合、最も古いエントリを削除する（LRU）。
- **制限事項:** CSSベースの解決では、キャッシュを確認する前に依然として `window.getComputedStyle()` を呼び出す。このキャッシュは繰り返しのレイアウト計算を防ぐが、スタイルの読み取りを完全に排除するわけではない。

### Shared Frame Scroll Metrics

場所: `dom/virtualListDomObserver.ts`

- **目的:** フレームごとにスクロールメトリクスを1回読み取り、スケジュールされたその測定中にactive subscriberへ渡す。
- **スコープ:** `ScrollerViewportEntry` 1つにつき1件。
- **無効化:** スクロールのフラッシュごとに新しく読み取られ、最終的なクリーンアップ時に保留状態がクリアされる。

### Flat Grid Runtime Memo

場所: `row-models/flatVirtualGridRuntimeModel.ts`

- **目的:** 依存関係に変更がない限り、再評価をまたいでも論理セルのソースと行モデルの同一性を安定して維持する。
- **スコープ:** フックインスタンスごとに1つの論理ソースエントリと1つの行モデルエントリ。
- **無効化:** コンテンツリビジョン、キーリビジョン、表示可能なページネーション形状、またはグリッドレイアウトキーの変更。
- **呼び出し元の責任:** items配列がインプレース（破壊的）で変更された場合、呼び出し元は `itemsRevision` を更新しなければならない。リゾルバ関数の同一性を変えずにキーの解決動作が変わる場合、呼び出し元は `keyRevision` を更新しなければならない。

### Engine Snapshot Fast Paths

場所: `core/virtualListEngine.ts`

- **目的:** 行モデルのリビジョン、マウント範囲、全体の高さが再利用を許容する場合、マウントされたセルの再構築をスキップする。
- **スコープ:** 次のエンジン計算に渡される以前のスナップショット。
- **無効化:** 選択されたファストパスによって宣言された依存関係のいずれかの変更。
- **制限事項:** 可視性メタデータを管理する呼び出し元は、新しい `previewVisible` 範囲を出力しながら、マウントされたセルを再利用する可能性がある。呼び出し元は自身の可視性状態を更新する責任がある。

## Mutation Ownership

- `VirtualListSnapshot` およびすべてのビルド結果は、高速な構築のために内部型がミューテーションを許可している場合でも、公開された後は厳密に読み取り専用となる。
- リコンシリエーション（差分調整）ビルダーは、新しく割り当てられた配列やマップを返す前にミューテーションすることが可能である。ただし、以前に公開されたビルドは **絶対に** ミューテーションしてはならない。
- `ScrollerViewportEntry` は、単一のactive subscriber、保留中の測定フラグ、依存オブザーバー、およびスクロールフェーズフラグを所有・管理する。
- スクロールフェーズフラグの状態遷移は、`dom/scrollerViewportScrollPhase.ts` を経由して処理されなければならない。
- 構造ミューテーションを無視するためのセレクターは `dom/structureMutationObserver.ts` に定義されている。無視されたミューテーションは意図的にレイアウト計算を抑制するため、新しい無視ルールを追加する際は必ず固有のテストを追加すること。

## 測定チェックリスト（Measurement Checklist）

パフォーマンスに影響を与える重要なホットパスを変更する場合は、少なくとも以下のデータを取得すること。

- カード数が `100`、`1_000`、`10_000` のときのマウントされたDOMノード数。
- No-op（実質的な変更なし）の測定時における、マウントされたセルのビルド数。
- `300` スクロールフレームにわたる `32` スクロールコンテナでのスクロールメトリクスの読み取り回数。
- active list内および別スクロールコンテナ上の構造ミューテーション時における、スケジュールされたレイアウト測定の回数。
- 変更したキャッシュにおける、キャッシュのヒット数、ミス数、無効化数、および破棄（エビクション）数。

現状、すべてのキャッシュにデバッグカウンターが実装されているわけではない。キャッシュのチューニングを行う際は、本番環境のパフォーマンスに影響を与えないよう、既存のデバッグフラグの背後に診断用カウンターを追加すること。
