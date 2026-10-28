import assert from 'assert'
import { execFile } from 'child_process'
import { importSrc } from './tools/srcDir.mjs'


//spec: sgud/rule/rulebook.md 之 R-DIAG-06: 建構函式對不合格opt.url之例外訊息(throwUrlErr, 5個呼叫點, 其中dialect不符另回顯dialect)不得回顯帳號與密碼
//  訊息前綴(如invalid username or password in opt.url)與Error型態不變; 回顯之url經maskUrl: 有://為<scheme>://***(其後一律不回顯: 本套件之連線字串mdb://帳號:密碼無主機,
//    帳密可含@與:, @之後可能是密碼之後半, 故不似其他後端把@之後視為主機而回顯), 無://為***, scheme須為識別字否則***
//  dialect[…] is not mdb 之dialect經maskDialect: 無://(整串可能就是帳密)或不合scheme樣式者為***
//呼叫點(src/WOrmMdb.mjs): S1 no dialect in opt.url、S2 dialect[…] is not mdb、S3 invalid username or password in opt.url、S4 invalid username in opt.url、S5 invalid password in opt.url
//註: 建構於解析失敗處即拋出, 不接觸Jet與檔案, 故本檔不依賴Windows


//wo, src位置依環境變數WORM_SRC_DIR(見tools/srcDir.mjs), 未給則為本專案之src
const { default: wo } = await importSrc('WOrmMdb.mjs')

const USER = 'Zuser9'
const PW = 'Zpw7'
//帳密與其後半(@之後)之標記, 輸出一律不得出現
const TOKENS = [USER, PW, 'Zonly7', 'Zuserpw7', 'Za9', 'Zb9', 'Zc9', 'Zp@ss7', 'ss7', 'Ztail9', 'Zcorp', 'Zhost9', '12345']


//build, 建構並回傳拋出之錯誤(不拋則回null)
function build(url, ext = {}) {
    try {
        wo({ url, ...ext })
    }
    catch (err) {
        return err
    }
    return null
}


//[站點, 不合格opt.url, 是否useEncryption, 預期完整訊息]
const CASES = [
    //S1 no dialect in opt.url: 以://開頭
    ['S1', `://${USER}:${PW}@db.local:1433`, false, 'no dialect in opt.url, opt.url[://***]'],
    ['S1', '://Zonly7', false, 'no dialect in opt.url, opt.url[://***]'],

    //S2 dialect[…] is not mdb: scheme非mdb, 無://(整串即dialect)、多個@、scheme含空白、://前夾帶帳密、過長之scheme
    ['S2', `oracle://${USER}:${PW}@db.local:1433`, false, 'dialect[oracle] is not mdb, opt.url[oracle://***]'],
    ['S2', `MDB://${USER}:${PW}`, false, 'dialect[MDB] is not mdb, opt.url[MDB://***]'],
    ['S2', `${USER}:${PW}@db.local:1433`, false, 'dialect[***] is not mdb, opt.url[***]'],
    ['S2', 'Zonly7', false, 'dialect[***] is not mdb, opt.url[***]'],
    ['S2', `oracle://${USER}:Zp@ss7@db.local:1433`, false, 'dialect[oracle] is not mdb, opt.url[oracle://***]'],
    ['S2', `bad scheme://${USER}:${PW}@db.local`, false, 'dialect[***] is not mdb, opt.url[***://***]'],
    ['S2', `${USER}:${PW}@db.local://x`, false, 'dialect[***] is not mdb, opt.url[***://***]'],
    ['S2', `${'a'.repeat(21)}://${USER}:${PW}@h`, false, 'dialect[***] is not mdb, opt.url[***://***]'],
    ['S2', 'postgres://Zuser9:Zpw7@Ztail9', false, 'dialect[postgres] is not mdb, opt.url[postgres://***]'],

    //S3 invalid username or password in opt.url: 帳密段不是兩段(無@之標準形式、多於兩段、僅一段、空、帳號為電郵含@而其後夾帶數字)
    ['S3', 'mdb://Zonly7', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],
    ['S3', 'mdb://Za9:Zb9:Zc9', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],
    ['S3', 'mdb://Za9:Zb9:Zc9@db.local', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],
    ['S3', 'mdb://Zuserpw7@db.local:1433', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],
    ['S3', 'mdb://', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],
    ['S3', 'mdb://Zalice@Zcorp.com:12345', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],
    ['S3', 'mdb://Za9:Zb9:Zc9@Ztail9', false, 'invalid username or password in opt.url, opt.url[mdb://***]'],

    //S4 invalid username in opt.url: useEncryption且帳號為空(密碼含@時其後半不得回顯)
    ['S4', `mdb://:${PW}`, true, 'invalid username in opt.url, opt.url[mdb://***]'],
    ['S4', `mdb://:${PW}@db.local:1`, true, 'invalid username in opt.url, opt.url[mdb://***]'],
    ['S4', 'mdb://:Zpw7@Ztail9', true, 'invalid username in opt.url, opt.url[mdb://***]'],

    //S5 invalid password in opt.url: useEncryption且密碼為空
    ['S5', `mdb://${USER}:`, true, 'invalid password in opt.url, opt.url[mdb://***]'],
    ['S5', `mdb://${USER}:@db.local:1`, true, 'invalid password in opt.url, opt.url[mdb://***]'],
    ['S5', 'mdb://Zuser9:@Ztail9', true, 'invalid password in opt.url, opt.url[mdb://***]'],
]


describe('WOrmMdb 建構函式opt.url錯誤訊息(R-DIAG-06)', function() {

    for (let [site, url, enc, msg] of CASES) {
        it(`${site} url[${url}]${enc ? ' useEncryption' : ''}: 前綴不變, 回顯為遮罩後形式, 帳密不出現, Error型態不變`, function() {
            let err = build(url, { useEncryption: enc })
            assert.ok(err instanceof Error, '應拋出Error')
            assert.strictEqual(Object.getPrototypeOf(err), Error.prototype, 'Error型態(原型)不變')
            assert.strictEqual(err.message, msg)
            for (let t of TOKENS) {
                assert.ok(err.message.indexOf(t) < 0 && String(err.stack).indexOf(t) < 0, `訊息或stack含帳密原文[${t}]`)
            }
        })
    }

    it('5個呼叫點之訊息前綴皆被涵蓋(S1~S5各至少1案)', function() {
        let got = new Set(CASES.map((v) => v[0]))
        assert.deepStrictEqual([...got].sort(), ['S1', 'S2', 'S3', 'S4', 'S5'])
    })

    it('合格opt.url照常建構: 預設、mdb://:、帳密齊全之加密設定', function() {
        assert.strictEqual(build(undefined), null)
        assert.strictEqual(build('mdb://:'), null)
        assert.strictEqual(build('mdb://username:password'), null)
        assert.strictEqual(build(`mdb://${USER}:${PW}`, { useEncryption: true }), null)
    })

    it('孤立代理碼元之opt.url: 前綴不變且不回顯值(R-WF, 先於url解析)', function() {
        let err = build(`mdb://${USER}:${PW}\uD800`)
        assert.ok(err instanceof Error)
        assert.strictEqual(err.message, 'invalid opt.url: string contains lone surrogate')
    })

    it('未捕獲時Node輸出至stderr之內容亦不含帳密(實際以子行程建構且不捕獲)', async function() {
        let run = (url, enc) => {
            return new Promise((resolve) => {
                execFile(process.execPath, ['test/tools/urlerrWorker.mjs', url, enc ? 'enc' : 'plain'], { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
                    resolve({ code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr) })
                })
            })
        }
        let r = await run(`oracle://${USER}:${PW}@db.local`, false)
        assert.notStrictEqual(r.code, 0, '未捕獲之例外應使行程非0結束')
        assert.ok(r.stderr.indexOf('dialect[oracle] is not mdb, opt.url[oracle://***]') >= 0, r.stderr.slice(0, 600))
        for (let t of TOKENS) {
            assert.ok(r.stderr.indexOf(t) < 0 && r.stdout.indexOf(t) < 0, `未捕獲之輸出含帳密原文[${t}]`)
        }
        let r2 = await run(`${USER}:${PW}@db.local`, false)
        assert.ok(r2.stderr.indexOf('dialect[***] is not mdb, opt.url[***]') >= 0, r2.stderr.slice(0, 600))
        for (let t of TOKENS) {
            assert.ok(r2.stderr.indexOf(t) < 0, `未捕獲之輸出含帳密原文[${t}]`)
        }
        let r3 = await run('mdb://:Zpw7@Ztail9', true)
        assert.ok(r3.stderr.indexOf('invalid username in opt.url, opt.url[mdb://***]') >= 0, r3.stderr.slice(0, 600))
        for (let t of TOKENS) {
            assert.ok(r3.stderr.indexOf(t) < 0, `未捕獲之輸出含帳密原文[${t}]`)
        }
    })

})
