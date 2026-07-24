import path from 'path'
import fs from 'fs'
import genID from 'wsemi/src/genID.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import execProcess from 'wsemi/src/execProcess.mjs'


//透過connMDB.exe(one-shot)操作Access mdb
//exe使用Windows內建Jet 4.0引擎(32-bit)與內建.NET Framework 4.x, 目標機不需安裝任何東西
//協定: 寫入fpIn(JSON)後呼叫exe, exe執行完寫fpRes(JSON), 查詢結果逐列寫jsonl檔


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
 * @returns {Object} 回傳操作物件{query,execute,create}
 */
function jetOpen(db) {

    async function run(cmds) {

        //fdExe
        let r = getFdExe()
        if (r === null) {
            return Promise.reject('can not find folder for connMDB')
        }
        let { fdExe, prog } = r

        //id
        let id = genID()

        //fpIn, fpRes
        let fpIn = `${fdExe}_${id}_in.json`
        let fpRes = `${fdExe}_${id}_res.json`

        //fpOuts, 為query類指令配置jsonl輸出檔
        let fpOuts = []
        cmds = cmds.map((c, k) => {
            if (c.type === 'query') {
                let fpOut = `${fdExe}_${id}_q${k}.jsonl`
                fpOuts.push(fpOut)
                return { ...c, fpOut }
            }
            return c
        })

        //save
        fs.writeFileSync(fpIn, JSON.stringify({ db, cmds }), 'utf8')

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

        //read query results
        let results = null
        if (res !== null && res.ok) {
            let iq = 0
            results = res.results.map((rr, k) => {
                if (cmds[k].type === 'query') {
                    let fpOut = fpOuts[iq]
                    iq++
                    let rows = []
                    let c = fs.readFileSync(fpOut, 'utf8')
                    let lines = c.split('\n')
                    for (let i = 0; i < lines.length; i++) {
                        let ln = lines[i]
                        if (ln !== '') {
                            rows.push(JSON.parse(ln))
                        }
                    }
                    return { ...rr, rows }
                }
                return rr
            })
        }

        //unlink temp files
        let fps = [fpIn, fpRes, ...fpOuts]
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

        //check, 指令執行有誤
        if (!res.ok) {
            return Promise.reject(res.error)
        }

        return results
    }

    return {

        //查詢, 回傳數據陣列
        query: async (sql) => {
            let rs = await run([{ type: 'query', sql }])
            return rs[0].rows
        },

        //執行(insert/update/delete), 回傳{ok,n}
        execute: async (sql) => {
            let rs = await run([{ type: 'execute', sql }])
            return rs[0]
        },

        //建立新mdb檔(db.password非空則建立加密檔)
        create: async () => {
            let rs = await run([{ type: 'create' }])
            return rs[0]
        },

    }
}


export default jetOpen
