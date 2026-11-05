// 測試專用假執行檔(非connMDB.exe): 依腳本檔逐次回傳預先寫好之結果檔內容, 供確定性驗證jet.mjs之重試政策(unit-jet-retry)
// 協定同connMDB.exe: connMDB.exe <fpIn> <fpRes>
// 環境變數FAKE_MDB_SCRIPT: 腳本檔路徑, 每行為一份完整之res.json文字; 第k次呼叫回傳第k行, 超過行數者重複最後一行
// 副作用檔: <腳本檔>.n 記錄已呼叫次數(純數字), <腳本檔>.log 逐次附加該次收到之fpIn內容(單行), 供測試核對[每次嘗試送出之指令相同]與次數;
//          <腳本檔>.t 逐次附加該次之起訖時間(UTC毫秒, 空白分隔), 供測試核對退避
// 僅用C# 5以內語法, 以Windows內建csc.exe編譯(同connMDB.exe之建置方式)
using System;
using System.IO;
using System.Text;

class FakeConnMDB {
    static int Main(string[] args) {
        if (args.Length < 2) {
            return 2;
        }
        string fpScript = Environment.GetEnvironmentVariable("FAKE_MDB_SCRIPT");
        if (string.IsNullOrEmpty(fpScript)) {
            return 3;
        }
        string fpN = fpScript + ".n";
        string fpLog = fpScript + ".log";
        string fpT = fpScript + ".t";
        long startMs = NowMs();

        int n = 0;
        if (File.Exists(fpN)) {
            int.TryParse(File.ReadAllText(fpN, Encoding.UTF8).Trim(), out n);
        }
        n++;
        File.WriteAllText(fpN, n.ToString(), new UTF8Encoding(false));

        string input = File.ReadAllText(args[0], Encoding.UTF8).Replace("\r", " ").Replace("\n", " ");
        File.AppendAllText(fpLog, input + "\n", new UTF8Encoding(false));

        string[] lines = File.ReadAllLines(fpScript, Encoding.UTF8);
        if (lines.Length == 0) {
            return 4;
        }
        int k = n - 1;
        if (k >= lines.Length) {
            k = lines.Length - 1;
        }
        File.WriteAllText(args[1], lines[k], new UTF8Encoding(false));
        //本次之起訖時間(毫秒), 供測試核對[相鄰兩次嘗試之間隔 ≥ 退避]: 下一次之起點 − 本次之終點 ≥ 兩次之間的延遲(計時器不會提早到期)
        File.AppendAllText(fpT, startMs.ToString() + " " + NowMs().ToString() + "\n", new UTF8Encoding(false));
        return 0;
    }

    static long NowMs() {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
    }
}
