# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

## 索引:哪類查哪檔(2026-10-30 分拆;節號與標題不變)

本帳本過長(分拆前 143,591 位元組),依全域設定 §14 依類型拆為 `rulebook_<類型>.md`,主檔只留本索引;各節之節號、標題與內容原樣搬移,未刪未改。程式碼、測試與文件中引用「`sgud/rule/rulebook.md` 之某條」者,依該條節號之前綴(如 `R-PK`、`R-FIND`、`R-WL`…)查下表到對應檔。新增規則寫入對應類型之檔;新類型另立 `rulebook_<類型>.md` 並於下表加列。

| 類 | 檔 | 內容 | 含之節 |
|---|---|---|---|
| 主鍵 | `sgud/rule/rulebook_pk.md` | 主鍵之命中判定(Jet 為準) | `R-PK` |
| 條件(find) | `sgud/rule/rulebook_find.md` | select/delAll 之條件轉譯、系列條件白名單之入口檢核,及主控寫入之三則系列規格摘要 | `R-FIND`、`R-WL`、〔條件(find)之支援範圍〕、〔delAll 與 find 之頂層語意〕、〔系列條件白名單〕 |
| 日期條件 | `sgud/rule/rulebook_float.md` | 非主鍵日期條件:浮動時間(牆上時間),及條件引用非白名單欄型之欄一律拒收(`R-FLOAT-07`) | `R-FLOAT` |
| 寫入值與實例 | `sgud/rule/rulebook_data.md` | 寫入 DATE 欄之日期範圍與字串正規化、字串良構檢核、sequelize 實例生命週期 | `R-DATE`、`R-WF`、`R-LIFE` |
| 診斷輸出 | `sgud/rule/rulebook_diag.md` | 診斷輸出之單一出口與預設安全、對外錯誤值之遮罩(含遷移至 wsemi 共用模組之 `R-DIAG-13`) | `R-DIAG` |
| 外部執行檔 | `sgud/rule/rulebook_bin.md` | connMDB.exe 之存放、下載、校驗與離線(D 類制式規格摘要) | `R-BIN` |

分拆當時各檔位元組數:`rulebook_pk.md` 12,376、`rulebook_find.md` 37,198、`rulebook_float.md` 26,037、`rulebook_data.md` 33,780、`rulebook_diag.md` 29,622、`rulebook_bin.md` 5,763、本檔(索引)另計。
