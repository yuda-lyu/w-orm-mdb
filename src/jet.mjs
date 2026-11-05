import path from 'path'
import os from 'os'
import fs from 'fs'
import genID from 'wsemi/src/genID.mjs'
import execProcess from 'wsemi/src/execProcess.mjs'
import ensureBins from './ensureBins.mjs'


//透過connMDB.exe(one-shot)操作Access mdb
//exe使用Windows內建Jet 4.0引擎(32-bit)與內建.NET Framework 4.x, 目標機不需安裝任何東西
//exe不隨npm包發布, 由ensureBins(wsemi之fsEnsureBins)於首次使用時依bin/manifest.json取得並校驗(制式規格: 外部執行檔之存放下載校驗與離線)
//協定: 寫入fpIn(JSON)後呼叫exe, exe執行完寫fpRes(JSON), 查詢結果逐列寫jsonl檔
//中介檔(fpIn, fpRes, jsonl)寫在作業系統暫存資料夾, 不寫在快取資料夾(快取內容由清單校驗, 且可能為共用或唯讀)


//Jet引擎之錯誤編號, 由exe取自OleDbError之SQLState(如3022重複鍵, 3058主鍵為Null, 3464型別不符)
//以數字判定錯誤類別而不比對錯誤訊息文字, 因該訊息隨系統語系而異
//註: 3022涵蓋主鍵與其他唯一索引之衝突, 兩者無從由錯誤碼區辨,
//    故呼叫端若須確認係主鍵衝突, 仍應另行核對該主鍵是否確實存在
const CODE_DUP_KEY = 3022 //重複鍵: 主鍵或唯一索引衝突


//連線開啟失敗之重試設定
//Jet以.ldb鎖檔協調多連線存取, 而本套件為one-shot(每次呼叫各自開啟與關閉連線),
//高頻開關下多行程或同行程多連線併發時, 該鎖檔之競爭會間歇令開啟失敗(Jet 3734),
//已實機重現: 未重試時跨行程併發save出現寫入遺失, 單行程useStable為false時出現逐筆失敗。
//此類失敗發生於連線開啟階段, 該次呼叫尚未執行任何指令(由exe之openFailed標記保證,
//exe於開啟失敗時一律中止其後cmds), 故重試整批為安全且不會重複套用寫入。
//同一併發開啟下另有四種錯誤已實機重現(探測: 純讀、零寫入、每輪換新mdb複本、16並行, 約0.7~1.2%之呼叫於首次嘗試開啟失敗, 皆為openFailed):
//  3031 Not a valid password.(無密碼之檔、連線字串不帶密碼亦出現)
//  3049 Cannot open database ''.(檔名為空字串)
//  3045 Could not use ''; file already in use.(檔名為空字串)
//  3356 You attempted to open a database that is already opened exclusively by user ... Try again when the database is available.(連線字串無任何獨占設定)
//其訊息中之檔名為空字串(3734亦曾見使用者與主機名稱為空字串, 但非必然), 推測為引擎讀到另一連線正在建立或釋放時尚未就緒之鎖檔狀態(機制未證實);
//實測檔案本身完好, 重試即可開啟(同樣之探測於納入前800次中7次失敗, 納入後800/800成功; 多數於第2次嘗試即恢復)。
//僅白名單錯誤碼重試: 3734(已實測之鎖競爭)、3050(鎖檔無法建立)、3045、3031、3049、3356(上述併發開啟時之暫態);
//白名單係依實測所見之碼, 非窮舉; 檔案不存在(3024)/格式不符(3343)/無錯誤碼等永久性開啟失敗不重試, 直接回報。
//註: 3031(真實之密碼錯誤)、3049(檔案毀損)、3045與3356(被他程序獨占)亦可為永久性, 無從由錯誤碼區辨,
//    故這類失敗同樣重試至用盡後才回報(結果與訊息不變), 代價為多花時間: 各次嘗試間隔25ms×序號, 7次間隔合計700ms, 另加8次啟動exe(各約0.3秒),
//    實測錯誤密碼由約0.33秒變為約3.4秒才回報
const nTryOpen = 8
const msTryOpen = 25
const codesTryOpen = [3734, 3050, 3045, 3031, 3049, 3356]


//exe未產出結果檔且無執行錯誤文字時之固定詞彙reject(R-DIAG: WOrmMdb之outErr據以原樣交出; 其餘reject為Jet引擎、執行檔之取得與執行之錯誤, 屬外來值, 由WOrmMdb經diag.err)
const ERR_NO_RES = 'connMDB.exe did not produce result file'


/**
 * 等待指定毫秒
 *
 * @ignore
 */
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}


//fnExe
const fnExe = `connMDB.exe`


/**
 * 取得connMDB.exe之絕對路徑
 *
 * 註: 每次呼叫皆經ensureBins, 其於本行程首次使用時校驗大小與SHA-256, 之後以檔案識別判定未變者不重複雜湊
 * 註: 取得失敗(離線缺檔, 下載失敗, 雜湊不符等)時reject帶code之Error, 此時尚未執行任何指令
 *
 * @ignore
 */
async function getProg() {
    let bins = await ensureBins({ names: fnExe })
    return bins[fnExe]
}


/**
 * 開啟mdb操作物件
 *
 * @param {Object} [db={}] 輸入資料庫設定物件
 * @param {String} [db.path] 輸入mdb檔案位置字串
 * @param {String} [db.password=''] 輸入資料庫密碼字串, 空字串代表無密碼
 * @returns {Object} 回傳操作物件{run,query,execute,create}
 */
function jetOpen(db) {

    /**
     * 低階執行, 一次呼叫exe跑完全部cmds
     *
     * 註: 僅於exe未產出結果檔時reject; 個別cmd之失敗一律經results逐筆回報而不reject,
     * 令呼叫端得以errorCode判別衝突與其他錯誤並各自處置
     * 註: 連線開啟失敗(openFailed, 即零語句已執行)且錯誤碼屬可重試之併發開啟暫態(鎖競爭類與讀到未就緒狀態類)時整批重試, 至多8次嘗試, 見codesTryOpen之說明;
     * 重試耗盡或不可重試者, 回傳之結果物件仍帶openFailed為true, 供呼叫端辨識為整批性錯誤
     *
     * @param {Array} cmds 輸入指令陣列, 各項為{type,sql,stopOnError}
     * @param {Object} [opt={}] 輸入設定物件
     * @param {Boolean} [opt.useTransaction=false] 輸入是否將整批cmds包在單一交易內, 任一失敗即回滾
     * @returns {Promise} 回傳Promise，resolve回傳{ok,error,stopped,rolledBack,openFailed,results}
     */
    async function run(cmds, opt = {}) {

        //整批重試, 僅限[開啟失敗且零語句已執行]且錯誤碼屬鎖競爭類者
        let res = null
        for (let i = 0; i < nTryOpen; i++) {

            //runOnce
            res = await runOnce(cmds, opt)

            //check, 非開啟失敗即定案
            if (res.openFailed !== true) {
                break
            }

            //check, 永久性開啟失敗(檔案不存在/格式不符/無錯誤碼等)不重試, 直接回報
            let ec = ((res.results || [])[0] || {}).errorCode
            if (codesTryOpen.indexOf(ec) < 0) {
                break
            }

            //delay, 線性退避
            if (i + 1 < nTryOpen) {
                await delay(msTryOpen * (i + 1))
            }
        }

        return res
    }


    /**
     * 執行一次exe呼叫
     *
     * @ignore
     */
    async function runOnce(cmds, opt = {}) {

        //prog, 取得失敗時整批reject(尚未執行任何指令)
        let prog = await getProg()

        //fdTmp
        let fdTmp = os.tmpdir()

        //useTransaction
        let useTransaction = opt.useTransaction === true

        //id
        let id = genID()

        //fpIn, fpRes
        let fpIn = path.join(fdTmp, `_${id}_in.json`)
        let fpRes = path.join(fdTmp, `_${id}_res.json`)

        //fpOuts, 為query類指令配置jsonl輸出檔, 以cmd索引為鍵以免因失敗略過而錯位
        let fpOuts = {}
        cmds = cmds.map((c, k) => {
            if (c.type === 'query') {
                let fpOut = path.join(fdTmp, `_${id}_q${k}.jsonl`)
                fpOuts[k] = fpOut
                return { ...c, fpOut }
            }
            return c
        })

        //save
        fs.writeFileSync(fpIn, JSON.stringify({ db, useTransaction, cmds }), 'utf8')

        //execProcess
        let errTemp = null
        await execProcess(prog, [fpIn, fpRes])
            .catch((err) => {
                errTemp = err.toString()
            })

        //read res
        let res = null
        try {
            res = JSON.parse(fs.readFileSync(fpRes, 'utf8'))
        }
        catch (err) {}

        //read query results, 僅該筆query成功者方有輸出檔
        if (res !== null) {
            res.results = (res.results || []).map((rr, k) => {
                if (cmds[k] && cmds[k].type === 'query' && rr.ok) {
                    let rows = []
                    try {
                        let c = fs.readFileSync(fpOuts[k], 'utf8')
                        let lines = c.split('\n')
                        for (let i = 0; i < lines.length; i++) {
                            let ln = lines[i]
                            if (ln !== '') {
                                rows.push(JSON.parse(ln))
                            }
                        }
                    }
                    catch (err) {}
                    return { ...rr, rows }
                }
                return rr
            })
        }

        //unlink temp files
        let fps = [fpIn, fpRes, ...Object.values(fpOuts)]
        fps.forEach((fp) => {
            try {
                fs.unlinkSync(fp)
            }
            catch (err) {}
        })

        //check, exe未產出結果檔
        if (res === null) {
            return Promise.reject(errTemp || ERR_NO_RES)
        }

        return res
    }


    /**
     * 執行單一指令並於失敗時reject, 供只關心成敗之呼叫點使用
     *
     * @ignore
     */
    async function runOne(cmd, opt = {}) {
        let res = await run([cmd], opt)
        if (!res.ok) {
            return Promise.reject(res.error)
        }
        return res.results[0]
    }


    return {

        //低階, 多指令一次往返, 逐筆結果
        run,

        //查詢, 回傳數據陣列
        query: async (sql) => {
            let rr = await runOne({ type: 'query', sql })
            return rr.rows
        },

        //執行(insert/update/delete), 回傳{ok,n}
        execute: async (sql) => {
            let rr = await runOne({ type: 'execute', sql })
            return rr
        },

        //建立新mdb檔(db.password非空則建立加密檔)
        create: async () => {
            let rr = await runOne({ type: 'create' })
            return rr
        },

    }
}


export default jetOpen
export { CODE_DUP_KEY, ERR_NO_RES }
