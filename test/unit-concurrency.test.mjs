import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 T8 併發保證之宣告義務
//本檔為[單一行程內併發]與[跨行程併發]兩範圍皆成立之實測依據(記載於規格文件之[各套件符合狀態]);
//依T8, 僅於某範圍[無法保證]時才須於README宣告, 兩範圍皆成立故README不另提及
//
//註: Jet以.ldb鎖檔協調多連線存取, 而本套件為one-shot(每次呼叫各自開啟與關閉連線),
//    高頻開關下該鎖檔之競爭會間歇令連線開啟失敗(如Jet 3734);
//    該類失敗發生於尚未執行任何指令之階段, 故由jet.mjs重試整批而不會重複套用寫入


let nm = 'concurrency'
let ss = null


function mkW(fpStorage, ext = {}) {
    let w = wo(mkOpt(fpStorage, ext))
    w.on('error', function() {})
    return w
}


function mkStorage(fdTmp, tag) {
    let fp = `${fdTmp}/${tag}.mdb`
    fs.copyFileSync('./test/assets/worm_def.mdb', fp)
    return fp
}


//runProc, 另起行程對同一mdb檔操作, 用於驗證跨行程之原子性
//註: 子行程程式碼內嵌為字串並以env帶參數, 不另開工作者檔案, 與w-orm系列其他套件之作法一致
function runProc(mode, fpStorage, tag) {
    return new Promise((resolve) => {
        let code = `
import { pathToFileURL } from 'url'
let { default: WOrm } = await import(pathToFileURL(process.env.SRC).href)
let wo = WOrm({ url: 'mdb://:', db: 'worm', cl: 'users', fdModels: './models', storage: process.env.STORAGE })
wo.on('error', function() {})
let tag = process.env.TAG
let rs = []
for (let i = 0; i < 20; i++) {
    if (process.env.MODE === 'insert') {
        rs.push({ id: 'k' + i, name: tag, value: i })
    }
    else {
        rs.push(tag === 'A' ? { id: 's' + i, name: 'A' + i } : { id: 's' + i, value: i * 100 })
    }
}
if (process.env.MODE === 'insert') {
    let r = await wo.insert(rs)
    console.log(JSON.stringify({ tag, nInserted: r.nInserted }))
}
else {
    let r = await wo.save(rs)
    console.log(JSON.stringify({ tag, nOk: r.filter((v) => v.ok === 1).length }))
}
`
        let out = ''
        let p = spawn(process.execPath, ['--input-type=module', '-e', code], {
            shell: false,
            env: {
                ...process.env,
                SRC: path.resolve('./src/WOrmMdb.mjs'),
                STORAGE: path.resolve(fpStorage),
                MODE: mode,
                TAG: tag,
            },
        })
        p.stdout.on('data', (c) => {
            out += c.toString()
        })
        p.stderr.on('data', (c) => {
            out += c.toString()
        })
        p.on('close', () => {
            let r = null
            try {
                r = JSON.parse(out.trim())
            }
            catch (err) {
                r = { tag, err: out.trim() }
            }
            resolve(r)
        })
    })
}


if (isWindows()) {
    describe('WOrmMdb concurrency', function() {

        before(function() {
            ss = setupStorage(nm)
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        describe('單一行程內併發 (useStable為true, 預設)', function() {

            it('30個並行insert於相異主鍵, 筆數與計數皆精確', async function() {
                let fp = mkStorage(ss.fdTmp, 'sp-true')
                let w = mkW(fp)
                let pms = []
                for (let i = 0; i < 30; i++) {
                    pms.push(w.insert([{ id: `c${i}`, name: `N${i}`, value: i }]))
                }
                let rs = await Promise.all(pms)
                let nIns = rs.reduce((a, v) => a + v.nInserted, 0)
                assert.strict.strictEqual(nIns, 30, 'nInserted總和')
                assert.strict.strictEqual((await w.select()).length, 30, '資料表筆數')
            })

            it('30個並行insert於同一主鍵, 僅一次成功', async function() {
                let fp = mkStorage(ss.fdTmp, 'sp-true-same')
                let w = mkW(fp)
                let pms = []
                for (let i = 0; i < 30; i++) {
                    pms.push(w.insert([{ id: 'same', name: `N${i}`, value: i }]))
                }
                let rs = await Promise.all(pms)
                let nIns = rs.reduce((a, v) => a + v.nInserted, 0)
                assert.strict.strictEqual(nIns, 1, 'nInserted總和須為1')
                assert.strict.strictEqual((await w.select()).length, 1, '資料表筆數須為1')
            })

        })

        describe('單一行程內併發 (useStable為false)', function() {

            it('30個並行insert仍不遺失數據', async function() {
                let fp = mkStorage(ss.fdTmp, 'sp-false')
                let w = mkW(fp, { useStable: false })
                let pms = []
                for (let i = 0; i < 30; i++) {
                    pms.push(w.insert([{ id: `f${i}`, name: `N${i}`, value: i }]))
                }
                let rs = await Promise.all(pms)
                let nIns = rs.reduce((a, v) => a + v.nInserted, 0)
                assert.strict.strictEqual(nIns, 30, 'nInserted總和')
                assert.strict.strictEqual((await mkW(fp).select()).length, 30, '資料表筆數')
            })

            it('20個並行save於同一主鍵, 逐筆皆ok為1', async function() {
                let fp = mkStorage(ss.fdTmp, 'sp-false-save')
                let w = mkW(fp, { useStable: false })
                await w.insert([{ id: 'x', name: 'init', value: 0 }])
                let pms = []
                for (let i = 0; i < 20; i++) {
                    pms.push(w.save([{ id: 'x', value: i }]))
                }
                let rs = await Promise.all(pms)
                let nBad = rs.filter((v) => v[0].ok !== 1).length
                assert.strict.strictEqual(nBad, 0, `ok非1之筆數, 首個: ${JSON.stringify(rs.find((v) => v[0].ok !== 1))}`)
            })

        })

        describe('跨行程併發', function() {

            it('2行程對相同20個主鍵併發insert, nInserted總和為20且資料表僅20筆', async function() {
                let fp = mkStorage(ss.fdTmp, 'xp-insert')
                let rs = await Promise.all([
                    runProc('insert', fp, 'A'),
                    runProc('insert', fp, 'B'),
                ])
                let nSum = 0
                rs.forEach((o) => {
                    assert.strict.strictEqual(o.err, undefined, `行程[${o.tag}]不得失敗: ${o.err}`)
                    nSum += o.nInserted
                })
                assert.strict.strictEqual(nSum, 20, 'nInserted總和')
                assert.strict.strictEqual((await mkW(fp).select()).length, 20, '資料表筆數')
            })

            it('2行程對同一批主鍵各寫入不同欄位, 兩欄位全數保留', async function() {
                let fp = mkStorage(ss.fdTmp, 'xp-save')
                let rs = await Promise.all([
                    runProc('save', fp, 'A'),
                    runProc('save', fp, 'B'),
                ])
                rs.forEach((o) => {
                    assert.strict.strictEqual(o.err, undefined, `行程[${o.tag}]不得失敗: ${o.err}`)
                    assert.strict.strictEqual(o.nOk, 20, `行程[${o.tag}]之逐筆ok數`)
                })
                let all = await mkW(fp).select()
                assert.strict.strictEqual(all.length, 20, '資料表筆數')
                let nBoth = all.filter((v) => typeof v.name === 'string' && v.name.length > 0 && typeof v.value === 'number').length
                assert.strict.strictEqual(nBoth, 20, `兩欄位皆保留之筆數, 樣本: ${JSON.stringify(all.slice(0, 2))}`)
            })

        })

    })
}
