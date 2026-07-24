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
//   fpIn (UTF-8 JSON): { "db": { "path": "...", "password": "" }, "cmds": [ ... ] }
//     cmd 種類:
//       { "type": "create" }                          -> 以 ADOX 建立新 Jet4 mdb(password 非空則建加密檔)
//       { "type": "query",   "sql": "...", "fpOut": "..." } -> 查詢, 逐列串流寫入 fpOut (UTF-8 jsonl)
//       { "type": "execute", "sql": "..." }           -> 執行, 回傳影響列數
//   fpRes (UTF-8 JSON): { "ok": bool, "error": string|null, "results": [ { "ok", "n", "count", "error" } ] }
//
// 設計要點:
//   - 一次程序生命週期開一條連線跑完全部 cmds, 循序執行, 首錯即停(其後 cmds 不執行)
//   - stdout/stderr 不承載資料(避免編碼/緩衝問題), 一切經檔案
//   - 查詢結果逐列寫 jsonl(\n 結尾, 無 \r), 大結果集不物化於記憶體
//   - 只用 CLR4 基線 API, 於任何 .NET Framework 4.x 機器可執行

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
    static long DoQuery(OleDbConnection cn, string sql, string fpOut) {
        long count = 0;
        using (OleDbCommand cmd = new OleDbCommand(sql, cn))
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
        return count;
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

            ArrayList cmds = req.ContainsKey("cmds") ? (ArrayList)req["cmds"] : new ArrayList();

            List<string> parts = new List<string>();
            bool allOk = true;
            string firstErr = null;

            OleDbConnection cn = null; //延遲開啟: create 類不需先開連線
            try {
                for (int k = 0; k < cmds.Count; k++) {
                    Dictionary<string, object> c = (Dictionary<string, object>)cmds[k];
                    string type = (string)c["type"];
                    StringBuilder pr = new StringBuilder();
                    try {
                        if (type == "create") {
                            DoCreate(dbPath, dbPwd);
                            pr.Append("{\"ok\":true}");
                        }
                        else if (type == "query") {
                            if (cn == null) {
                                cn = new OleDbConnection(BuildConnStr(dbPath, dbPwd));
                                cn.Open();
                            }
                            string fpOut = (string)c["fpOut"];
                            long n = DoQuery(cn, (string)c["sql"], fpOut);
                            pr.Append("{\"ok\":true,\"count\":").Append(n.ToString(CultureInfo.InvariantCulture)).Append('}');
                        }
                        else if (type == "execute") {
                            if (cn == null) {
                                cn = new OleDbConnection(BuildConnStr(dbPath, dbPwd));
                                cn.Open();
                            }
                            int n;
                            using (OleDbCommand cmd = new OleDbCommand((string)c["sql"], cn)) {
                                n = cmd.ExecuteNonQuery();
                            }
                            pr.Append("{\"ok\":true,\"n\":").Append(n.ToString(CultureInfo.InvariantCulture)).Append('}');
                        }
                        else {
                            throw new Exception("unknown cmd type: " + type);
                        }
                    }
                    catch (Exception exCmd) {
                        allOk = false;
                        firstErr = exCmd.Message;
                        StringBuilder er = new StringBuilder();
                        er.Append("{\"ok\":false,\"error\":");
                        JsonEscapeTo(er, exCmd.Message);
                        er.Append('}');
                        parts.Add(er.ToString());
                        break; //首錯即停
                    }
                    parts.Add(pr.ToString());
                }
            }
            finally {
                if (cn != null) {
                    try { cn.Close(); } catch (Exception) { }
                }
            }

            res.Append("{\"ok\":").Append(allOk ? "true" : "false").Append(",\"error\":");
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
                    er.Append("{\"ok\":false,\"error\":");
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
