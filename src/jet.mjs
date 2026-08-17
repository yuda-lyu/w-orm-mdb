import path from 'path'
import fs from 'fs'
import genID from 'wsemi/src/genID.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import execProcess from 'wsemi/src/execProcess.mjs'


//透過connMDB.exe(one-shot)操作Access mdb
//exe使用Windows內建Jet 4.0引擎(32-bit)與內建.NET Framework 4.x, 目標機不需安裝任何東西
//協定: 寫入fpIn(JSON)後呼叫exe, exe執行完寫fpRes(JSON), 查詢結果逐列寫jsonl檔


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
//僅白名單錯誤碼重試(3734為已實測之鎖競爭, 3050為鎖檔無法建立),
//密碼錯誤/檔案不存在/格式不符等永久性開啟失敗不重試, 直接回報
const nTryOpen = 8
const msTryOpen = 25
const codesTryOpen = [3734, 3050]


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


function getFdExe() {

    //fdSrv
    let fdSrv = path.resolve()

    //fnExe
    let fnExe = `connMDB.exe`

    //fdExe
    let fdExe = ''
    if (true) {
        let fdExeSrc = `${fdSrv}/src/`
        let fdExeNM = `${fdSrv}/node_modules/w-orm-mdb/src/`
        if (fsIsFile(`${fdExeSrc}${fnExe}`)) {
            fdExe = fdExeSrc
        }
        else if (fsIsFile(`${fdExeNM}${fnExe}`)) {
            fdExe = fdExeNM
        }
        else {
            return null
        }
    }

    return {
        fdExe,
        prog: `${fdExe}${fnExe}`,
    }
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
     * 註: 連線開啟失敗(openFailed)且錯誤碼屬可重試之鎖競爭類時整批重試, 見codesTryOpen之說明;
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

            //check, 永久性開啟失敗(密碼錯誤/檔案不存在/格式不符)不重試, 直接回報
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

        //fdExe
        let r = getFdExe()
        if (r === null) {
            return Promise.reject('can not find folder for connMDB')
        }
        let { fdExe, prog } = r

        //useTransaction
        let useTransaction = opt.useTransaction === true

        //id
        let id = genID()

        //fpIn, fpRes
        let fpIn = `${fdExe}_${id}_in.json`
        let fpRes = `${fdExe}_${id}_res.json`

        //fpOuts, 為query類指令配置jsonl輸出檔, 以cmd索引為鍵以免因失敗略過而錯位
        let fpOuts = {}
        cmds = cmds.map((c, k) => {
            if (c.type === 'query') {
                let fpOut = `${fdExe}_${id}_q${k}.jsonl`
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
            return Promise.reject(errTemp || 'connMDB.exe did not produce result file')
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
export { CODE_DUP_KEY }
