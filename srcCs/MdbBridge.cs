using System;
using System.Collections;
using System.Collections.Generic;
using System.Data.OleDb;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

// MdbBridge (connMDB.exe): w-orm-mdb 的 one-shot 橋接程式
//
// 全鏈零安裝: Windows 內建 Jet 4.0 引擎(32-bit) + 內建 .NET Framework 4.x(CLR4, 不鎖高版) + 內建 csc 編譯
//
// 用法: connMDB.exe <fpIn> <fpRes>
//   fpIn (UTF-8 JSON):
//     {
//       "db": { "path": "...", "password": "" },
//       "useTransaction": false,          // 選填, 預設 false; 為 true 時整批 cmds 包在單一交易內
//       "cmds": [ ... ]
//     }
//     cmd 種類:
//       { "type": "create" }                                -> 以 ADOX 建立新 Jet4 mdb(password 非空則建加密檔)
//       { "type": "query",   "sql": "...", "fpOut": "..." }  -> 查詢, 逐列串流寫入 fpOut (UTF-8 jsonl)
//       { "type": "execute", "sql": "..." }                  -> 執行, 回傳影響列數
//     cmd 共同選填欄位:
//       "stopOnError": true               // 預設 true(首錯即停); 為 false 時該 cmd 失敗仍續跑其後 cmds
//
//   fpRes (UTF-8 JSON):
//     {
//       "ok": bool,                       // 全部 cmds 皆成功才為 true
//       "error": string|null,             // 首個錯誤訊息
//       "stopped": bool,                  // 是否因錯誤而中止
//       "rolledBack": bool,               // 是否因錯誤而回滾交易
//       "openFailed": bool,               // 是否為[連線開啟失敗且尚未執行任何指令], 呼叫端得據以安全重試整批
//       "results": [ { "ok", "n", "count", "error", "errorCode", "hresult", "errors" } ]
//     }
//     errorCode 為 Jet 引擎錯誤編號(取自 OleDbError.SQLState), 如 3022 重複鍵
//
// 設計要點:
//   - 一次程序生命週期開一條連線跑完全部 cmds, 循序執行
//   - stopOnError 為 false 時單一 cmd 失敗不中止其後 cmds, 供 insert 之[已存在則跳過]語義一次往返完成
//   - errorCode 取 OleDbError 之 SQLState(Jet 引擎錯誤編號, 重複鍵為 3022), 令呼叫端不倚賴多語系之錯誤訊息文字
//   - useTransaction 為 true 時整批包在 OleDbTransaction 內, 任一 cmd 失敗即回滾且不寫入任何一筆
//     (交易與 stopOnError 為 false 之語義互斥, 故開啟交易時一律視同首錯即停)
//   - 連線開啟失敗一律中止其後 cmds(不受 stopOnError 影響), 令 openFailed 恆代表[零語句已執行],
//     呼叫端據以重試整批不會重複套用寫入
//   - stdout/stderr 不承載資料(避免編碼/緩衝問題), 一切經檔案
//   - 查詢結果逐列寫 jsonl(\n 結尾, 無 \r), 大結果集不物化於記憶體
//   - 只用 CLR4 基線 API 與 C# 5 語法(內建 csc 無字串內插與 ?. 運算子), 於任何 .NET Framework 4.x 機器可執行

static class MdbBridge {

    //---------------------------------------------------------------- JSON 輸出(手刻, 僅需序列化)

    static void JsonEscapeTo(StringBuilder sb, string s) {
        sb.Append('"');
        for (int i = 0; i < s.Length; i++) {
            char c = s[i];
            switch (c) {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') {
                        sb.Append("\\u").Append(((int)c).ToString("x4"));
                    }
                    else {
                        sb.Append(c);
                    }
                    break;
            }
        }
        sb.Append('"');
    }

    static void JsonValueTo(StringBuilder sb, object v) {
        if (v == null || v is DBNull) {
            sb.Append("null");
            return;
        }
        if (v is string) {
            JsonEscapeTo(sb, (string)v);
            return;
        }
        if (v is bool) {
            sb.Append(((bool)v) ? "true" : "false");
            return;
        }
        if (v is DateTime) {
            DateTime dt = (DateTime)v;
            string s = (dt.Millisecond > 0)
                ? dt.ToString("yyyy-MM-ddTHH:mm:ss.fff", CultureInfo.InvariantCulture)
                : dt.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
            JsonEscapeTo(sb, s);
            return;
        }
        if (v is byte[]) {
            JsonEscapeTo(sb, Convert.ToBase64String((byte[])v));
            return;
        }
        if (v is Guid) {
            JsonEscapeTo(sb, v.ToString());
            return;
        }
        if (v is double) {
            double d = (double)v;
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
            return;
        }
        if (v is float) {
            float f = (float)v;
            if (float.IsNaN(f) || float.IsInfinity(f)) { sb.Append("null"); return; }
            sb.Append(f.ToString("R", CultureInfo.InvariantCulture));
            return;
        }
        if (v is decimal) {
            sb.Append(((decimal)v).ToString(CultureInfo.InvariantCulture));
            return;
        }
        if (v is IFormattable) { //int, short, byte, long...
            sb.Append(((IFormattable)v).ToString(null, CultureInfo.InvariantCulture));
            return;
        }
        JsonEscapeTo(sb, v.ToString());
    }

    //---------------------------------------------------------------- 輸入解析輔助

    static bool GetBool(Dictionary<string, object> d, string k, bool def) {
        if (d == null || !d.ContainsKey(k) || d[k] == null) {
            return def;
        }
        object v = d[k];
        if (v is bool) {
            return (bool)v;
        }
        return def;
    }

    // 取錯誤碼: 取 OleDbError 之 SQLState, 其於 Jet provider 承載的是 Jet 引擎錯誤編號
    // (如 3022 重複鍵, 3058 主鍵為 Null, 3192 找不到資料表), 為有文件且與系統語系無關之穩定識別;
    // NativeError 為衍生值而無文件, 故不採。取不到時回 0
    // 註: 令呼叫端得以數字判定衝突, 不倚賴隨系統語系而異之錯誤訊息文字
    static int GetErrCode(Exception ex) {
        OleDbException oex = ex as OleDbException;
        if (oex == null) {
            return 0;
        }
        try {
            if (oex.Errors != null && oex.Errors.Count > 0) {
                string st = oex.Errors[0].SQLState;
                int v;
                if (!string.IsNullOrEmpty(st) && int.TryParse(st, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) {
                    return v;
                }
            }
        }
        catch (Exception) { }
        return 0;
    }

    // 取錯誤之診斷細節, 供辨識錯誤類別與問題排查
    static void AppendErrDetail(StringBuilder sb, Exception ex) {
        OleDbException oex = ex as OleDbException;
        if (oex == null) {
            return;
        }
        sb.Append(",\"hresult\":").Append(oex.ErrorCode.ToString(CultureInfo.InvariantCulture));
        try {
            if (oex.Errors != null && oex.Errors.Count > 0) {
                sb.Append(",\"errors\":[");
                for (int i = 0; i < oex.Errors.Count; i++) {
                    if (i > 0) {
                        sb.Append(',');
                    }
                    sb.Append("{\"nativeError\":").Append(oex.Errors[i].NativeError.ToString(CultureInfo.InvariantCulture));
                    sb.Append(",\"sqlState\":");
                    JsonEscapeTo(sb, oex.Errors[i].SQLState == null ? "" : oex.Errors[i].SQLState);
                    sb.Append(",\"source\":");
                    JsonEscapeTo(sb, oex.Errors[i].Source == null ? "" : oex.Errors[i].Source);
                    sb.Append('}');
                }
                sb.Append(']');
            }
        }
        catch (Exception) { }
    }

    //---------------------------------------------------------------- 各操作

    static string BuildConnStr(string path, string password) {
        string cs = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=" + path + ";Persist Security Info=False;";
        if (!string.IsNullOrEmpty(password)) {
            cs += "Jet OLEDB:Database Password=" + password + ";";
        }
        return cs;
    }

    // 以 ADOX(內建 msadox.dll, 後期繫結)建立新 Jet4 mdb; password 非空則建立加密檔
    static void DoCreate(string path, string password) {
        string cs = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=" + path + ";Jet OLEDB:Engine Type=5;";
        if (!string.IsNullOrEmpty(password)) {
            cs += "Jet OLEDB:Database Password=" + password + ";Jet OLEDB:Encrypt Database=True;";
        }
        Type t = Type.GetTypeFromProgID("ADOX.Catalog");
        if (t == null) {
            throw new Exception("ADOX.Catalog not available");
        }
        object cat = Activator.CreateInstance(t);
        try {
            t.InvokeMember("Create", BindingFlags.InvokeMethod, null, cat, new object[] { cs });
        }
        finally {
            try { System.Runtime.InteropServices.Marshal.ReleaseComObject(cat); } catch (Exception) { }
        }
    }

    // 查詢逐列串流寫 jsonl, 回傳列數
    static long DoQuery(OleDbConnection cn, OleDbTransaction tx, string sql, string fpOut) {
        long count = 0;
        using (OleDbCommand cmd = new OleDbCommand(sql, cn)) {
            if (tx != null) {
                cmd.Transaction = tx;
            }
            using (OleDbDataReader rd = cmd.ExecuteReader())
            using (StreamWriter w = new StreamWriter(fpOut, false, new UTF8Encoding(false), 1 << 20)) {
                int nf = rd.FieldCount;
                string[] names = new string[nf];
                for (int i = 0; i < nf; i++) {
                    names[i] = rd.GetName(i);
                }
                StringBuilder sb = new StringBuilder(256);
                while (rd.Read()) {
                    sb.Length = 0;
                    sb.Append('{');
                    for (int i = 0; i < nf; i++) {
                        if (i > 0) {
                            sb.Append(',');
                        }
                        JsonEscapeTo(sb, names[i]);
                        sb.Append(':');
                        JsonValueTo(sb, rd.GetValue(i));
                    }
                    sb.Append('}');
                    w.Write(sb.ToString());
                    w.Write('\n'); //明確寫\n, 避免\r\n
                    count++;
                }
            }
        }
        return count;
    }

    // 執行, 回傳影響列數
    static int DoExecute(OleDbConnection cn, OleDbTransaction tx, string sql) {
        using (OleDbCommand cmd = new OleDbCommand(sql, cn)) {
            if (tx != null) {
                cmd.Transaction = tx;
            }
            return cmd.ExecuteNonQuery();
        }
    }

    //---------------------------------------------------------------- 主流程

    static int Main(string[] args) {
        string fpRes = (args.Length >= 2) ? args[1] : null;
        StringBuilder res = new StringBuilder();
        try {
            if (args.Length < 2) {
                throw new Exception("usage: connMDB.exe <fpIn> <fpRes>");
            }
            string fpIn = args[0];

            JavaScriptSerializer ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;
            Dictionary<string, object> req = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(fpIn, Encoding.UTF8));

            Dictionary<string, object> dbCfg = (Dictionary<string, object>)req["db"];
            string dbPath = (string)dbCfg["path"];
            string dbPwd = dbCfg.ContainsKey("password") && dbCfg["password"] != null ? (string)dbCfg["password"] : "";

            bool useTransaction = GetBool(req, "useTransaction", false);

            ArrayList cmds = req.ContainsKey("cmds") ? (ArrayList)req["cmds"] : new ArrayList();

            List<string> parts = new List<string>();
            bool allOk = true;
            bool stopped = false;
            bool rolledBack = false;
            bool openFailed = false;
            string firstErr = null;

            OleDbConnection cn = null; //延遲開啟: create 類不需先開連線
            OleDbTransaction tx = null;
            try {
                for (int k = 0; k < cmds.Count; k++) {
                    Dictionary<string, object> c = (Dictionary<string, object>)cmds[k];
                    string type = (string)c["type"];

                    //開啟交易時語義為全有全無, 一律視同首錯即停
                    bool stopOnError = useTransaction ? true : GetBool(c, "stopOnError", true);

                    //openErr, 本 cmd 是否因連線開啟失敗而錯誤
                    bool openErr = false;

                    StringBuilder pr = new StringBuilder();
                    try {
                        if (type == "create") {
                            //create 為建檔而非連線內操作, 不納入交易
                            DoCreate(dbPath, dbPwd);
                            pr.Append("{\"ok\":true}");
                        }
                        else if (type == "query" || type == "execute") {
                            if (cn == null) {
                                OleDbConnection cnNew = new OleDbConnection(BuildConnStr(dbPath, dbPwd));
                                try {
                                    cnNew.Open();
                                }
                                catch (Exception) {
                                    //連線開啟失敗(Jet 於多行程或多連線併發時, 因 .ldb 鎖檔之競爭會間歇拋出 3734 等錯誤)
                                    openErr = true;
                                    //本次尚未執行任何指令時標記 openFailed, 令呼叫端得安全重試整批
                                    if (parts.Count == 0) {
                                        openFailed = true;
                                    }
                                    try { cnNew.Dispose(); } catch (Exception) { }
                                    throw;
                                }
                                cn = cnNew;
                                if (useTransaction) {
                                    tx = cn.BeginTransaction();
                                }
                            }
                            if (type == "query") {
                                string fpOut = (string)c["fpOut"];
                                long n = DoQuery(cn, tx, (string)c["sql"], fpOut);
                                pr.Append("{\"ok\":true,\"count\":").Append(n.ToString(CultureInfo.InvariantCulture)).Append('}');
                            }
                            else {
                                int n = DoExecute(cn, tx, (string)c["sql"]);
                                pr.Append("{\"ok\":true,\"n\":").Append(n.ToString(CultureInfo.InvariantCulture)).Append('}');
                            }
                        }
                        else {
                            throw new Exception("unknown cmd type: " + type);
                        }
                    }
                    catch (Exception exCmd) {
                        allOk = false;
                        if (firstErr == null) {
                            firstErr = exCmd.Message;
                        }
                        StringBuilder er = new StringBuilder();
                        er.Append("{\"ok\":false,\"errorCode\":")
                          .Append(GetErrCode(exCmd).ToString(CultureInfo.InvariantCulture));
                        AppendErrDetail(er, exCmd);
                        er.Append(",\"error\":");
                        JsonEscapeTo(er, exCmd.Message);
                        er.Append('}');
                        parts.Add(er.ToString());
                        if (stopOnError || openErr) {
                            //開啟失敗一律中止其後 cmds(不受 stopOnError 影響):
                            //若續跑而其後 cmd 開啟成功並執行, openFailed 將不再代表[零語句已執行],
                            //呼叫端據以重試整批即會重複執行已成功之語句
                            stopped = true;
                            break;
                        }
                        continue; //不中止, 續跑其後 cmds
                    }
                    parts.Add(pr.ToString());
                }

                //交易收尾: 全數成功才提交, 否則回滾令一筆都不寫入
                if (tx != null) {
                    if (allOk) {
                        tx.Commit();
                    }
                    else {
                        try { tx.Rollback(); rolledBack = true; } catch (Exception) { }
                    }
                }
            }
            catch (Exception exRun) {
                //交易提交/回滾自身失敗等, 視為整批失敗
                allOk = false;
                if (firstErr == null) {
                    firstErr = exRun.Message;
                }
                if (tx != null) {
                    try { tx.Rollback(); rolledBack = true; } catch (Exception) { }
                }
            }
            finally {
                if (tx != null) {
                    try { tx.Dispose(); } catch (Exception) { }
                }
                if (cn != null) {
                    try { cn.Close(); } catch (Exception) { }
                }
            }

            res.Append("{\"ok\":").Append(allOk ? "true" : "false")
               .Append(",\"stopped\":").Append(stopped ? "true" : "false")
               .Append(",\"rolledBack\":").Append(rolledBack ? "true" : "false")
               .Append(",\"openFailed\":").Append(openFailed ? "true" : "false")
               .Append(",\"error\":");
            if (firstErr == null) {
                res.Append("null");
            }
            else {
                JsonEscapeTo(res, firstErr);
            }
            res.Append(",\"results\":[").Append(string.Join(",", parts.ToArray())).Append("]}");
            File.WriteAllText(fpRes, res.ToString(), new UTF8Encoding(false));
            return 0;
        }
        catch (Exception ex) {
            //頂層失敗: 盡力寫結果檔讓呼叫端拿到錯誤
            try {
                if (fpRes != null) {
                    StringBuilder er = new StringBuilder();
                    er.Append("{\"ok\":false,\"stopped\":true,\"rolledBack\":false,\"openFailed\":false,\"error\":");
                    JsonEscapeTo(er, ex.Message);
                    er.Append(",\"results\":[]}");
                    File.WriteAllText(fpRes, er.ToString(), new UTF8Encoding(false));
                }
            }
            catch (Exception) { }
            return 1;
        }
    }
}
