import fs from 'fs'
import util from 'util'
import assert from 'assert'
import { importSrc } from './tools/srcDir.mjs'


//spec: sgud/rule/rulebook.md 之 R-DIAG: 診斷輸出單一出口(src/getDiag.mjs)之純函數測試, 不連線, 不依賴Jet(CI之ubuntu亦可跑)
//對應: 預設只輸出標籤與不含個資之摘要(R-DIAG-01)、logDetail還原細節且憑證遮罩(R-DIAG-02)、funLog收完整細節(R-DIAG-03)、依賴w-orm-reladb之genModelsByTabs須接受並使用diag(R-DIAG-05)、輸出不得使呼叫端拋錯(R-DIAG-07)、建構函式訊息之遮罩(R-DIAG-06)


//src位置依環境變數WORM_SRC_DIR(見tools/srcDir.mjs), 未給則為本專案之src
const { getOptLog, getDiag, getBriefErr, getSecrets, maskText, maskUrl, maskDialect, cpMask, getSqlStmt } = await importSrc('getDiag.mjs')

let PW = 'S3cretPw'
let USER = 'tuser'
let URL = `mdb://${USER}:${PW}`
let ID = 'u-secret-001@example.com'


//cap, 擷取console各方法之輸出
function cap(fn) {
    let lines = []
    let ks = ['log', 'info', 'warn', 'error', 'debug']
    let olds = ks.map((k) => console[k])
    ks.forEach((k) => {
        console[k] = (...a) => lines.push(a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v, (kk, vv) => (typeof vv === 'bigint' ? String(vv) : vv)))).join(' '))
    })
    try {
        fn()
    }
    finally {
        ks.forEach((k, i) => {
            console[k] = olds[i]
        })
    }
    return lines
}


describe('getOptLog', function() {

    it('R-DIAG-03 未給或型別錯誤者忽略並用預設(與本套件其他選項型別錯誤之處理一致: 不拋錯)', function() {
        for (let o of [undefined, null, {}, 1, 'x', { logDetail: 'true' }, { logDetail: 1 }, { logDetail: {} }, { funLog: 'x' }, { funLog: {} }, { funLog: null }]) {
            assert.deepStrictEqual(getOptLog(o), { logDetail: false, funLog: null }, JSON.stringify(o))
        }
    })

    it('R-DIAG-03 logDetail為true、funLog為函數才生效', function() {
        let f = () => {}
        assert.deepStrictEqual(getOptLog({ logDetail: true, funLog: f }), { logDetail: true, funLog: f })
        assert.deepStrictEqual(getOptLog({ logDetail: false }), { logDetail: false, funLog: null })
    })

    it('R-DIAG-03 讀取選項拋錯者忽略該選項, 不連累另一個有效選項', function() {
        let f = () => {}
        let o1 = {
            get logDetail() {
                throw new Error('x')
            },
            funLog: f
        }
        assert.deepStrictEqual(getOptLog(o1), { logDetail: false, funLog: f })
        let o2 = {
            logDetail: true,
            get funLog() {
                throw new Error('x')
            }
        }
        assert.deepStrictEqual(getOptLog(o2), { logDetail: true, funLog: null })
    })

})


describe('getDiag', function() {

    it('R-DIAG-01 預設只輸出標籤與摘要, 不呼叫getDetail(細節在預設路徑不被取得)', function() {
        let n = 0
        let diag = getDiag(getOptLog({}))
        let lines = cap(() => {
            diag('L1', { mode: 'insert', errType: 'Error' }, () => {
                n++
                return `detail ${ID}`
            })
            diag('L2', undefined, () => {
                n++
                return ID
            })
            diag('L3')
        })
        assert.deepStrictEqual(lines, ['L1 {"mode":"insert","errType":"Error"}', 'L2', 'L3'])
        assert.strictEqual(n, 0)
    })

    it('R-DIAG-02 logDetail為true時還原細節: 標籤加細節; bare者只輸出細節(與舊版該站之console.log(細節)相同)', function() {
        let diag = getDiag(getOptLog({ logDetail: true }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => `detail ${ID}`)
            diag('L2', { a: 1 }, () => `bare ${ID}`, true)
            diag('L3', undefined)
        })
        assert.deepStrictEqual(lines, [`L1 detail ${ID}`, `bare ${ID}`, 'L3'])
    })

    it('R-DIAG-03 funLog收(label, safe, detail), 不寫console; 無細節者只收兩個引數', function() {
        let got = []
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => ({ id: ID }))
            diag('L2', undefined)
        })
        assert.deepStrictEqual(lines, [])
        assert.strictEqual(got.length, 2)
        assert.deepStrictEqual(got[0], ['L1', { a: 1 }, { id: ID }])
        assert.strictEqual(got[1].length, 2)
        assert.deepStrictEqual(got[1], ['L2', undefined])
    })

    it('R-DIAG-01 摘要(safe)亦防禦性遮罩: 值含已知憑證(操作別恰為密碼、錯誤代碼恰為數字密碼)者以***取代, 不含者原樣', function() {
        let got = []
        let secrets = getSecrets('mdb://u:12345', 'u', '12345')
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)
        diag('L', { mode: '12345', errType: 'Error', errCode: 12345, other: 7 })
        diag('L', { mode: 'insert', errCode: 'ENOENT' })
        assert.deepStrictEqual(got[0][1], { mode: '***', errType: 'Error', errCode: '***', other: 7 })
        assert.deepStrictEqual(got[1][1], { mode: 'insert', errCode: 'ENOENT' })
        let lines = cap(() => {
            getDiag(getOptLog({}), secrets)('L', { mode: '12345' })
        })
        assert.deepStrictEqual(lines, ['L {"mode":"***"}'])
    })

    it('R-DIAG-03 funLog存在時logDetail不另寫console(funLog取代console)', function() {
        let got = []
        let diag = getDiag(getOptLog({ logDetail: true, funLog: (...a) => got.push(a) }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => 'd')
        })
        assert.deepStrictEqual(lines, [])
        assert.deepStrictEqual(got, [['L1', { a: 1 }, 'd']])
    })

    it('R-DIAG-07 輸出不得使呼叫端拋錯: funLog拋錯、getDetail拋錯、console拋錯皆吞下', function() {
        let diag1 = getDiag(getOptLog({
            funLog: () => {
                throw new Error('x')
            }
        }))
        diag1('L', { a: 1 }, () => 'd')

        let got = []
        let diag2 = getDiag(getOptLog({ logDetail: true }))
        let lines = cap(() => {
            diag2('L', { a: 1 }, () => {
                throw new Error('boom')
            })
        })
        got.push(...lines)
        assert.deepStrictEqual(got, ['L (unprintable)'])

        let diag3 = getDiag(getOptLog({ funLog: (l, s, d) => got.push(d) }))
        diag3('L', undefined, () => {
            throw new Error('boom')
        })
        assert.strictEqual(got[got.length - 1], '(unprintable)')

        let diag4 = getDiag(getOptLog({}))
        let old = console.log
        console.log = () => {
            throw new Error('console broken')
        }
        try {
            diag4('L', { a: 1 })
        }
        finally {
            console.log = old
        }
    })

    it('R-DIAG-07 funLog回傳reject之promise不成為unhandledRejection', async function() {
        let bad = []
        let fn = (e) => bad.push(e)
        process.on('unhandledRejection', fn)
        try {
            let diag = getDiag(getOptLog({ funLog: () => Promise.reject(new Error('rej')) }))
            diag('L', { a: 1 }, () => 'd')
            let diag2 = getDiag(getOptLog({ funLog: () => ({ then: (a, b) => Promise.reject(new Error('rej2')) }) }))
            diag2('L', { a: 1 }, () => 'd')
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        finally {
            process.off('unhandledRejection', fn)
        }
        assert.deepStrictEqual(bad.map((v) => v.message), [])
    })

    it('R-DIAG-02 憑證遮罩: 細節(console與funLog)中之密碼、帳密、連線字串一律以***取代, 其餘細節保留', function() {
        let secrets = getSecrets(URL, USER, PW)
        let err = new Error(`connect ${URL} failed for ${USER}:${PW} id=${ID}`)
        err.code = 'ENOENT'
        err.extra = { message: `pw=${PW}`, nested: [PW, { deep: `x${PW}y` }] }

        let got = []
        let diag1 = getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)
        diag1('L', { a: 1 }, () => ({ state: 'error', msg: err }))
        let d = got[0][2]
        let s = JSON.stringify(d) + String(d.msg.message) + String(d.msg.stack)
        assert.ok(s.indexOf(PW) < 0, '密碼未遮罩')
        assert.ok(s.indexOf(`${USER}:${PW}`) < 0 && s.indexOf(URL) < 0, '帳密或連線字串未遮罩')
        assert.ok(d.msg.message.indexOf(ID) >= 0, '非憑證之細節被誤遮')
        assert.strictEqual(d.msg.code, 'ENOENT')
        assert.ok(d.msg instanceof Error && d.msg !== err)
        assert.strictEqual(err.message.indexOf('***'), -1, '不得改動呼叫端之原物件')
        assert.ok(err.message.indexOf(PW) >= 0)

        let diag2 = getDiag(getOptLog({ logDetail: true }), secrets)
        let lines = cap(() => {
            diag2('L', { a: 1 }, () => ({ state: 'error', msg: err }))
            diag2('L', { a: 1 }, () => `Executing (default): SELECT * FROM t WHERE pw = '${PW}'`, true)
        })
        let all = lines.join('\n')
        assert.ok(all.indexOf(PW) < 0, `console輸出含密碼: ${all.slice(0, 300)}`)
        assert.ok(all.indexOf('***') >= 0)
    })

})


describe('依賴w-orm-reladb之genModelsByTabs(R-DIAG-05: 須接受第4個引數diag, 其輸出全經diag, 不直接console.log; 本套件不替換全域console.log)', function() {

    const fdDep = './test/temp-diaglog-dep'
    const tabs = (n) => ({ [n]: { id: { type: 'STRING', pk: true }, name: 'STRING' } })
    const badTabs = { 'bad|name': { id: { type: 'STRING', pk: true } } }
    //ver, 'x.y.z'轉為可比較之陣列(忽略預發佈與建置標記)
    const ver = (s) => String(s).replace(/^[^0-9]*/, '').split(/[-+]/)[0].split('.').map((v) => parseInt(v, 10))
    const geVer = (a, b) => {
        for (let k = 0; k < 3; k++) {
            if (a[k] !== b[k]) {
                return a[k] > b[k]
            }
        }
        return true
    }
    const MIN = '1.1.17'

    before(function() {
        fs.rmSync(fdDep, { recursive: true, force: true })
    })

    after(function() {
        fs.rmSync(fdDep, { recursive: true, force: true })
    })

    it('依賴版本下限: package.json之w-orm-reladb下限與已安裝版本皆≥1.1.17(1.1.16以前之genModelsByTabs不認得diag而直接console.log路徑與錯誤)', function() {
        let pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
        let range = pkg.dependencies['w-orm-reladb']
        assert.ok(geVer(ver(range), ver(MIN)), `package.json之w-orm-reladb下限[${range}]低於${MIN}`)
        let inst = JSON.parse(fs.readFileSync('./node_modules/w-orm-reladb/package.json', 'utf8')).version
        assert.ok(geVer(ver(inst), ver(MIN)), `已安裝w-orm-reladb[${inst}]低於${MIN}`)
    })

    it('依賴之genModelsByTabs以第4個引數diag輸出(label, safe, getDetail), 不直接寫console: 預設之diag輸出只有標籤與{name,type}, 路徑與存檔錯誤只在getDetail', async function() {
        let { default: rl } = await import('w-orm-reladb/src/genModelsByTabs.mjs')
        let calls = []
        let lines = cap(() => {
            rl(fdDep, tabs('tdep'), { type: 'js' }, (...a) => calls.push(a))
            rl(fdDep, badTabs, { type: 'js' }, (...a) => calls.push(a))
        })
        assert.deepStrictEqual(lines, [], '依賴不得繞過diag直接寫console')
        let gen = calls.filter((a) => a[0] === 'generate file:')
        let bad = calls.filter((a) => a[0] === 'save file catch')
        assert.strictEqual(gen.length, 1, JSON.stringify(calls))
        assert.strictEqual(bad.length, 1, JSON.stringify(calls))
        assert.deepStrictEqual(gen[0][1], { name: 'tdep', type: 'js' })
        assert.ok(String(gen[0][2]()).indexOf('tdep.js') >= 0, 'getDetail回路徑')
        assert.deepStrictEqual({ name: bad[0][1].name, type: bad[0][1].type, errType: bad[0][1].errType }, { name: 'bad|name', type: 'js', errType: 'Error' })
        assert.ok(bad[0][1].errCode === undefined || /^E[A-Z]+$/.test(bad[0][1].errCode), `errCode應為機器代碼: ${bad[0][1].errCode}`)
        assert.ok(bad[0][2]() instanceof Error, 'getDetail回存檔失敗之錯誤')
        //safe(第2個引數)不含路徑與錯誤文字(機器代碼errCode屬摘要, 不在此限)
        let s = JSON.stringify(calls.map((a) => a[1]))
        for (let t of ['tdep.js', fdDep, 'bad|name.js', 'no such file', 'open']) {
            assert.ok(s.indexOf(t) < 0, `safe含[${t}]: ${s}`)
        }
    })

    it('以本套件之diag為第4個引數: 預設輸出只有標籤與{name,type}; logDetail還原路徑與錯誤(憑證遮罩); funLog收三個引數且不寫console', async function() {
        let { default: rl } = await import('w-orm-reladb/src/genModelsByTabs.mjs')
        let secrets = getSecrets(URL, USER, PW)
        let run = (diag) => {
            rl(fdDep, tabs('tdep2'), { type: 'js' }, diag)
            rl(fdDep, badTabs, { type: 'js' }, diag)
        }
        let l1 = cap(() => run(getDiag(getOptLog({}), secrets)))
        assert.strictEqual(l1.length, 2, l1.join('|'))
        assert.ok(l1[0].startsWith('generate file: ') && l1[1].startsWith('save file catch '), l1.join('|'))
        for (let t of ['tdep2.js', fdDep, 'bad|name.js', 'no such file', 'open']) {
            assert.ok(l1.join('\n').indexOf(t) < 0, `預設輸出含[${t}]: ${l1.join('|')}`)
        }
        let l2 = cap(() => run(getDiag(getOptLog({ logDetail: true }), secrets)))
        assert.ok(l2.join('\n').indexOf('tdep2.js') >= 0 && l2.join('\n').indexOf('bad|name') >= 0, l2.join('|'))
        let got = []
        let l3 = cap(() => run(getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)))
        assert.deepStrictEqual(l3, [])
        assert.strictEqual(got.length, 2)
        assert.deepStrictEqual(got[0].slice(0, 2), ['generate file:', { name: 'tdep2', type: 'js' }])
        assert.ok(String(got[0][2]).indexOf('tdep2.js') >= 0)
        assert.ok(got[1][2] instanceof Error)
    })

})


describe('getBriefErr', function() {

    it('R-DIAG-01 只列類別與機器代碼, 不含訊息文字', function() {
        let e = new Error(`failed for ${ID} ${PW}`)
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        class MyHandlerError extends Error {}
        let e2 = new MyHandlerError(`dup ${ID}`)
        e2.code = 'ERR_HANDLER'
        assert.deepStrictEqual(getBriefErr(e2), { errType: 'MyHandlerError', errCode: 'ERR_HANDLER' })
        let e3 = new Error('x')
        e3.code = 3022
        assert.deepStrictEqual(getBriefErr(e3), { errType: 'Error', errCode: 3022 })
    })

    it('R-DIAG-01 字串或非物件之reject值只列型別(字串內容可能夾帶資料; 本套件之Jet錯誤多以字串reject)', function() {
        assert.deepStrictEqual(getBriefErr(`fail ${ID}`), { errType: 'string' })
        assert.deepStrictEqual(getBriefErr(null), { errType: 'null' })
        assert.deepStrictEqual(getBriefErr(undefined), { errType: 'undefined' })
        assert.deepStrictEqual(getBriefErr(12), { errType: 'number' })
        assert.deepStrictEqual(getBriefErr({ message: ID }), { errType: 'object' })
    })

    it('R-DIAG-01 code須為機器代碼樣式, 資料值樣式者不列(含過大整數、一般字串、電郵)', function() {
        //E開頭夾帶數字者(如身分證字號樣式E123456789)不屬機器代碼(外審Argon探測)
        for (let c of [ID, 'alice', 'U-0001', 99999999, 1.5, NaN, {}, [], 'E', 'ERR_', 'sqlite_busy', '', 'a'.repeat(60), 'E123456789', 'EAB1', 'E1', 'E2BIG1']) {
            let e = new Error('x')
            e.code = c
            assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' }, String(c))
        }
        for (let c of ['ENOENT', 'ERR_INVALID_ARG_TYPE', 'EAI_AGAIN', 'E2BIG', 18456, 0, -1]) {
            let e = new Error('x')
            e.code = c
            assert.deepStrictEqual(getBriefErr(e), { errType: 'Error', errCode: c }, String(c))
        }
    })

    it('R-DIAG-01 建構子名稱不合識別字樣式者列為Error; 不執行getter與使用端程式', function() {
        let e = new Error('x')
        function Weird() {}
        Object.defineProperty(Weird, 'name', { value: `bad name ${ID}` })
        Object.defineProperty(e, 'constructor', { value: Weird, configurable: true })
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        function Okay() {}
        Object.defineProperty(e, 'constructor', { value: Okay, configurable: true })
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Okay' })

        let called = 0
        let e2 = new Error('x')
        Object.defineProperty(e2, 'code', {
            get() {
                called++
                return 'ENOENT'
            },
            configurable: true
        })
        assert.deepStrictEqual(getBriefErr(e2), { errType: 'Error' })
        assert.strictEqual(called, 0)
    })

    it('R-DIAG-07 Proxy與陷阱拋錯之值不使其拋錯', function() {
        let p = new Proxy({}, {
            getOwnPropertyDescriptor() {
                throw new Error('trap')
            },
            getPrototypeOf() {
                throw new Error('trap')
            }
        })
        let r = getBriefErr(p)
        assert.ok(r !== null && typeof r === 'object' && typeof r.errType === 'string')
        assert.ok(JSON.stringify(r).indexOf('trap') < 0)
    })

})


describe('maskText 與 getSecrets', function() {

    it('R-DIAG-02 getSecrets: 略過空值, 含連線字串、帳密、密碼與其URL編碼、單引號加倍形式, 長者在前', function() {
        assert.deepStrictEqual(getSecrets('', '', ''), [])
        let nc = getSecrets('mdb://:', '', '')
        assert.ok(nc.includes('mdb://:') && nc.every((v) => v !== ''), JSON.stringify(nc))
        assert.strictEqual(maskText('connect mdb://: failed', nc), 'connect *** failed')
        let ss = getSecrets(URL, USER, PW)
        for (let v of [URL, USER, PW, `${USER}:${PW}`]) {
            assert.ok(ss.includes(v), v)
        }
        let enc = getSecrets('x://a b:p@ss@h:1', 'a b', 'p@ss')
        assert.ok(enc.includes(encodeURIComponent('p@ss')))
        let q = getSecrets('mdb://u:pa\'ss', 'u', 'pa\'ss')
        assert.ok(q.includes('pa\'\'ss'), JSON.stringify(q))
        assert.strictEqual(maskText('SELECT \'pa\'\'ss\' FROM t', q), 'SELECT \'***\' FROM t')
        for (let k = 1; k < ss.length; k++) {
            assert.ok(ss[k - 1].length >= ss[k].length)
        }
    })

    it('R-DIAG-02 maskText: 連線字串內嵌之帳密、含@之URL亦遮罩(不依賴已知秘密)', function() {
        assert.strictEqual(maskText(`a ${URL} b`, getSecrets(URL, USER, PW)), 'a *** b')
        assert.strictEqual(maskText('connect postgres://who:pw@host:5432/db now', []), 'connect postgres://***@host:5432/db now')
        assert.strictEqual(maskText('plain text no secret', getSecrets(URL, USER, PW)), 'plain text no secret')
    })

    it('R-DIAG-02 maskText: 帳密含未編碼之@時取至最後一個@(不留密碼後半段); 不吞掉其後以空白分隔之文字', function() {
        assert.strictEqual(maskText('connect postgres://alice:secret@part@host/db', []), 'connect postgres://***@host/db')
        assert.strictEqual(maskText('see http://example.com:80 and mail me@x.com', []), 'see http://example.com:80 and mail me@x.com')
    })

    it('R-DIAG-02 maskText: 內嵌之mdb://連線字串整段(至空白或引號)不回顯, 不依賴已知秘密(帳密可含@與:, @之後可能是密碼後半; 外審Argon探測)', function() {
        assert.strictEqual(maskText('connect mdb://alice:p@ssword123 failed', []), 'connect mdb://*** failed')
        assert.strictEqual(maskText('open "mdb://u:p:q@r" now', []), 'open "mdb://***" now')
        assert.strictEqual(maskText('MDB://x:y and mdb://', []), 'mdb://*** and mdb://***')
        assert.strictEqual(maskText('again mdb://***', []), 'again mdb://***', '已遮罩者冪等')
        assert.strictEqual(maskText('plain mdb file of mdb: type', []), 'plain mdb file of mdb: type')
    })

    it('R-DIAG-02 帳號單獨出現時至少3字元才遮罩(過短者會吞掉無關文字); 與密碼並列之形式不受此限', function() {
        let ss = getSecrets('mdb://u:Zpw7Zpw7', 'u', 'Zpw7Zpw7')
        assert.strictEqual(maskText('user u wrote Zpw7Zpw7 and u:Zpw7Zpw7', ss), 'user u wrote *** and ***')
    })

})


describe('cpMask', function() {

    it('R-DIAG-02 不改動原物件, 循環參照與過深/過大結構有界, 函數與二進位以標記字串代替', function() {
        let a = { name: ID, pw: PW, list: [PW, 1, null, undefined], fn() {}, buf: Buffer.from(PW), d: new Date(0) }
        a.self = a
        let deep = { v: PW }
        let cur = deep
        for (let k = 0; k < 30; k++) {
            cur.next = { v: PW }
            cur = cur.next
        }
        a.deep = deep
        let secrets = getSecrets(URL, USER, PW)
        let r = cpMask(a, secrets)
        assert.notStrictEqual(r, a)
        assert.strictEqual(a.pw, PW)
        assert.strictEqual(r.name, ID)
        assert.strictEqual(r.pw, '***')
        assert.deepStrictEqual(r.list, ['***', 1, null, undefined])
        assert.strictEqual(r.fn, '[Function]')
        assert.ok(String(r.buf).startsWith('[Binary'))
        assert.strictEqual(r.d.getTime(), 0)
        assert.strictEqual(r.self, r)
        let n = 0
        for (let x = r.deep; typeof x === 'object' && x !== null; x = x.next) {
            n++
            assert.ok(JSON.stringify(x.v).indexOf(PW) < 0)
        }
        assert.ok(n < 30, `過深結構未截斷: ${n}`)
        assert.ok(JSON.stringify(r, (k, v) => (k === 'self' ? undefined : v)).indexOf(PW) < 0)
    })

    it('R-DIAG-02 Error之副本仍為Error: message、stack、cause、自有屬性皆遮罩', function() {
        let e = new Error(`m ${PW}`, { cause: new Error(`c ${PW}`) })
        e.extra = `x ${PW}`
        let r = cpMask(e, getSecrets(URL, USER, PW))
        assert.ok(r instanceof Error)
        assert.strictEqual(r.message, 'm ***')
        assert.ok(typeof r.stack === 'string' && r.stack.indexOf(PW) < 0 && r.stack.indexOf('m ***') >= 0)
        assert.strictEqual(r.cause.message, 'c ***')
        assert.strictEqual(r.extra, 'x ***')
        assert.strictEqual(e.message, `m ${PW}`)
    })

    it('R-DIAG-02 屬性鍵與Symbol描述含憑證者亦遮罩; 數字密碼之同值數字亦遮罩(至少4位)', function() {
        let secrets = getSecrets('mdb://u:12345', 'u', '12345')
        let e = new Error('x')
        e[PW] = 'v'
        e[Symbol(PW)] = 'w'
        e.parameters = { password: 12345, count: 7, big: 12345n }
        let r = cpMask(Object.assign(e, {}), getSecrets(URL, USER, PW))
        let keys = Reflect.ownKeys(r).map((k) => String(k))
        assert.ok(keys.every((k) => k.indexOf(PW) < 0), keys.join('|'))
        assert.ok(keys.includes('***') && keys.includes('Symbol(***)'), keys.join('|'))
        let r2 = cpMask({ password: 12345, count: 7, big: 12345n, s: '12345' }, secrets)
        assert.deepStrictEqual(r2, { password: '***', count: 7, big: '***', s: '***' })
    })

    it('R-DIAG-02 Symbol值之描述含憑證者遮罩; 包裝物件(Object(字串)等)以原始值處置而非被拆成逐字元之物件(外審Argon探測)', function() {
        let secrets = getSecrets(URL, USER, PW)
        let r = cpMask({ tok: Symbol(PW), keep: Symbol('ok'), arr: [Symbol(PW)], s: Object(PW), b: Object(Symbol(PW)) }, secrets)
        assert.strictEqual(r.tok.description, '***')
        assert.strictEqual(r.keep.description, 'ok')
        assert.strictEqual(r.arr[0].description, '***')
        assert.strictEqual(r.s, '***', '包裝之字串密碼')
        assert.strictEqual(r.b.description, '***', '包裝之Symbol')
        let sec2 = getSecrets('mdb://u:12345678', 'u', '12345678')
        assert.strictEqual(cpMask(Object(12345678), sec2), '***')
        assert.strictEqual(cpMask(Object(12345678n), sec2), '***')
        assert.strictEqual(cpMask(Object('ok'), secrets), 'ok')
        assert.strictEqual(cpMask(Object(true), secrets), true)
        assert.strictEqual(cpMask(Object(7), sec2), 7)
    })

    it('R-DIAG-02 副本不沿用原型: 繼承屬性不外帶, 繼承之util.inspect.custom不被執行; Error之name取原型鏈上之資料屬性', function() {
        class MyErr extends Error {}
        MyErr.prototype.token = PW
        MyErr.prototype.name = 'MyErrName'
        MyErr.prototype[Symbol.for('nodejs.util.inspect.custom')] = () => `PW=${PW}`
        let r = cpMask(new MyErr('m'), getSecrets(URL, USER, PW))
        assert.ok(r instanceof Error)
        assert.strictEqual(r.token, undefined)
        assert.strictEqual(r.name, 'MyErrName')
        assert.ok(!util.inspect(r).includes(PW), util.inspect(r))
        class Foo {
            constructor() {
                this.a = 1
            }
        }
        Foo.prototype.b = PW
        Foo.prototype[Symbol.for('nodejs.util.inspect.custom')] = () => `PW=${PW}`
        let r2 = cpMask(new Foo(), getSecrets(URL, USER, PW))
        assert.deepStrictEqual(r2, { a: 1 })
        assert.ok(!util.inspect(r2).includes(PW))
    })

    it('R-DIAG-07 不執行使用端程式: Symbol.toStringTag之getter、自訂stack與message存取器皆不被執行', function() {
        let called = []
        let e = new Error('m')
        Object.defineProperty(e, Symbol.toStringTag, {
            get() {
                called.push('tag')
                return 'Error'
            }
        })
        Object.defineProperty(e, 'stack', {
            get() {
                called.push('stack')
                return `stack ${PW}`
            },
            configurable: true
        })
        Object.defineProperty(e, 'message', {
            get() {
                called.push('message')
                return `msg ${PW}`
            },
            configurable: true
        })
        let r = cpMask(e, getSecrets(URL, USER, PW))
        assert.ok(r instanceof Error)
        assert.deepStrictEqual(called, [])
        assert.ok(!util.inspect(r).includes(PW))
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        assert.deepStrictEqual(called, [])
    })

    it('R-DIAG-07 Error之name或message為存取器(或其值非字串)時不讀stack: V8首次讀stack時以之格式化標頭, 會執行使用端程式(外審Argon探測); 字串資料屬性之name照常', function() {
        let called = []
        let e1 = new Error('init')
        Object.defineProperty(e1, 'message', {
            get() {
                called.push('message')
                return `msg ${PW}`
            },
            configurable: true
        })
        Object.defineProperty(e1, 'name', {
            get() {
                called.push('name')
                return `N_${PW}`
            },
            configurable: true
        })
        let e2 = new Error('x')
        Object.defineProperty(e2, 'message', {
            value: {
                toString() {
                    called.push('toString')
                    return PW
                }
            },
            configurable: true
        })
        class Acc extends Error {
            get name() {
                called.push('classname')
                return 'Acc'
            }
        }
        let secrets = getSecrets(URL, USER, PW)
        for (let e of [e1, e2, new Acc('m')]) {
            let r = cpMask(e, secrets)
            assert.ok(r instanceof Error)
            assert.deepStrictEqual(called, [])
            assert.ok(!util.inspect(r).includes(PW))
        }
        class MyOk extends Error {}
        MyOk.prototype.name = 'MyOk'
        let ok = cpMask(new MyOk(`m ${PW}`), secrets)
        assert.ok(typeof ok.stack === 'string' && ok.stack.indexOf('m ***') >= 0 && ok.stack.indexOf(PW) < 0, '對照: 安全之Error仍帶遮罩後之stack')
    })

    it('R-DIAG-07 getter不被執行(以標記字串代替), 拋錯之getter不使其拋錯', function() {
        let called = 0
        let o = {
            get a() {
                called++
                return PW
            },
            b: 1
        }
        let r = cpMask(o, getSecrets(URL, USER, PW))
        assert.strictEqual(called, 0)
        assert.strictEqual(r.a, '[Getter/Setter]')
        assert.strictEqual(r.b, 1)
    })

})


describe('第二輪外審(Flash)之補強: funLog、getDiag之選項、陣列鍵、Error類別名、摘要getter、空字串秘密', function() {

    it('R-DIAG-03 使用端funLog內呼叫console.log(常見之轉送寫法): funLog每筆輸出只被呼叫一次, 其console.log輸出一次(不遞迴)', function() {
        let n = 0
        let diag = getDiag(getOptLog({
            funLog: (l) => {
                n++
                console.log(`[LOG] ${l}`)
            }
        }))
        let lines = cap(() => {
            diag('generate file:', { name: 't' }, () => '/p')
        })
        assert.strictEqual(n, 1)
        assert.deepStrictEqual(lines, ['[LOG] generate file:'])
    })

    it('R-DIAG-07 funLog拋錯、getDetail拋錯、console拋錯後, 其後之diag仍照常輸出(無殘留狀態)', function() {
        let diagThrow = getDiag(getOptLog({
            funLog: () => {
                throw new Error('x')
            }
        }))
        diagThrow('L', { a: 1 }, () => {
            throw new Error('d')
        })
        let old = console.log
        console.log = () => {
            throw new Error('console broken')
        }
        try {
            getDiag(getOptLog({}))('L', { a: 1 })
        }
        finally {
            console.log = old
        }
        let got = []
        getDiag(getOptLog({ funLog: (...a) => got.push(a) }))('after', { a: 1 })
        assert.deepStrictEqual(got, [['after', { a: 1 }]])
        let lines = cap(() => {
            getDiag(getOptLog({}))('after', { a: 1 })
        })
        assert.deepStrictEqual(lines, ['after {"a":1}'])
    })

    it('R-DIAG-07 diag之外層防護: 內部任何拋錯(遮罩憑證時秘密清單之走訪拋錯)皆不外洩給呼叫端, 該次輸出放棄, 其後不受影響', function() {
        let secrets = getSecrets(URL, USER, PW)
        let diag = getDiag(getOptLog({}), secrets)
        secrets[Symbol.iterator] = () => {
            throw new Error('iterate broken')
        }
        let lines = cap(() => {
            assert.doesNotThrow(() => diag('label', { a: 1 }))
        })
        assert.deepStrictEqual(lines, [])
        delete secrets[Symbol.iterator]
        let lines2 = cap(() => {
            diag('label', { a: 1 })
        })
        assert.deepStrictEqual(lines2, ['label {"a":1}'])
    })

    it('R-DIAG-03 getDiag之第一引數為任意物件(未給funLog者)時照常輸出, 不被當成有funLog而靜默吞下全部輸出', function() {
        for (let o of [{}, { logDetail: false }, undefined, null]) {
            let lines = cap(() => {
                getDiag(o)('L1', { a: 1 })
            })
            assert.deepStrictEqual(lines, ['L1 {"a":1}'], String(JSON.stringify(o)))
        }
        let lines2 = cap(() => {
            getDiag({ logDetail: true })('L2', { a: 1 }, () => 'd')
        })
        assert.deepStrictEqual(lines2, ['L2 d'])
    })

    it('R-DIAG-02 陣列上之擴充字串鍵與Symbol鍵之憑證亦遮罩; 索引鍵、length與稀疏槽位不受影響', function() {
        let secrets = getSecrets(URL, USER, PW)
        let arr = ['a', PW, 'c']
        arr[PW] = 'v'
        arr[Symbol(PW)] = 'w'
        let r = cpMask(arr, secrets)
        assert.deepStrictEqual(r.slice(), ['a', '***', 'c'])
        let keys = Reflect.ownKeys(r).map((k) => String(k))
        assert.ok(keys.every((k) => k.indexOf(PW) < 0), keys.join('|'))
        assert.ok(keys.includes('0') && keys.includes('2') && keys.includes('length') && keys.includes('***') && keys.includes('Symbol(***)'), keys.join('|'))
        let sp = [1]
        sp[5] = PW
        let r2 = cpMask(sp, secrets)
        assert.strictEqual(r2.length, 6)
        assert.strictEqual(r2[5], '***')
        assert.ok(!(3 in r2), '稀疏槽位保持空洞')
    })

    it('R-DIAG-02 Error副本保留類別名稱: class MyError extends Error{}(名稱為建構子之靜態name, 不在原型上)取建構子名稱; 不合識別字樣式者、一般Error仍為Error; 自有name資料屬性照舊', function() {
        let secrets = getSecrets(URL, USER, PW)
        class CustomDbError extends Error {}
        let r = cpMask(new CustomDbError(`m ${PW}`), secrets)
        assert.strictEqual(r.name, 'CustomDbError')
        assert.strictEqual(String(r), 'CustomDbError: m ***')
        class Weird extends Error {}
        Object.defineProperty(Weird, 'name', { value: `bad name ${PW}` })
        assert.strictEqual(cpMask(new Weird('x'), secrets).name, 'Error')
        assert.strictEqual(cpMask(new Error('x'), secrets).name, 'Error')
        let e = new Error('x')
        e.name = 'Own'
        assert.strictEqual(cpMask(e, secrets).name, 'Own')
    })

    it('R-DIAG-07 摘要(safe)含存取器者不執行之、不使呼叫端拋錯(摘要由src以固定欄位組成, 此為防禦)', function() {
        let called = 0
        let got = []
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }))
        diag('L', {
            get bomb() {
                called++
                throw new Error('boom')
            },
            ok: 1
        })
        assert.strictEqual(called, 0)
        assert.strictEqual(got.length, 1)
        assert.strictEqual(got[0][1].ok, 1)
    })

    it('R-DIAG-02 maskText: 空字串或非字串之秘密不處理(否則字串被切碎, 於每個字元之間插入遮罩)', function() {
        assert.strictEqual(maskText('hello', ['']), 'hello')
        assert.strictEqual(maskText('hello', ['', 'ell', null, 5]), 'h***o')
    })

})


describe('第三輪外審(Flash)之補強: label與摘要鍵與Error類別名之遮罩、二進位與陣列存取器、SQL敘述白名單', function() {

    it('R-DIAG-02 label(呼叫端傳入之字串, 依賴之diag呼叫亦同, 可能含連線字串)於預設、logDetail、funLog三管道皆遮罩', function() {
        let secrets = getSecrets(URL, USER, PW)
        let msg = `failed connecting to ${URL} with ${USER}:${PW}`
        let l1 = cap(() => {
            getDiag(getOptLog({}), secrets)(msg)
        })
        assert.deepStrictEqual(l1, ['failed connecting to *** with ***'])
        let l2 = cap(() => {
            getDiag(getOptLog({ logDetail: true }), secrets)(msg, undefined, () => `detail ${PW}`)
        })
        assert.deepStrictEqual(l2, ['failed connecting to *** with *** detail ***'])
        let got = []
        cap(() => {
            getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)(msg)
        })
        assert.deepStrictEqual(got, [['failed connecting to *** with ***', undefined]])
        let l3 = cap(() => {
            getDiag(getOptLog({}), secrets)(`label ${PW}`, { a: 1 })
        })
        assert.deepStrictEqual(l3, ['label *** {"a":1}'])
    })

    it('R-DIAG-01 摘要(safe)之屬性鍵亦遮罩', function() {
        let got = []
        getDiag(getOptLog({ funLog: (...a) => got.push(a) }), getSecrets(URL, USER, PW))('L', { [PW]: 'v', ok: 1 })
        assert.deepStrictEqual(got[0][1], { '***': 'v', 'ok': 1 })
    })

    it('R-DIAG-02 Error副本之類別名稱(取自建構子之靜態name)亦遮罩: 類別名恰為密碼者不外洩', function() {
        let secrets = getSecrets('mdb://u:SecretPass', 'u', 'SecretPass')
        class SecretPass extends Error {}
        let r = cpMask(new SecretPass('query failed'), secrets)
        assert.strictEqual(r.name, '***')
        assert.strictEqual(String(r), '***: query failed')
    })

    it('R-DIAG-02 cpMask: 二進位資料(Uint8Array、ArrayBuffer、DataView)以標記字串代替; 陣列索引之getter不被執行', function() {
        let r = cpMask({ u8: new Uint8Array(3), ab: new ArrayBuffer(8), dv: new DataView(new ArrayBuffer(2)) }, [])
        assert.deepStrictEqual(r, { u8: '[Binary 3 bytes]', ab: '[Binary 8 bytes]', dv: '[Binary 2 bytes]' })
        let called = 0
        let a = [1]
        Object.defineProperty(a, 1, {
            get() {
                called++
                return PW
            },
            enumerable: true
        })
        let r2 = cpMask(a, getSecrets(URL, USER, PW))
        assert.strictEqual(called, 0)
        assert.strictEqual(r2[0], 1)
        assert.strictEqual(r2[1], '[Getter/Setter]')
    })

    it('R-DIAG-01 getSqlStmt: 白名單之全部敘述種類(含小寫)皆辨識, 其餘為OTHER', function() {
        for (let w of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'WITH']) {
            assert.strictEqual(getSqlStmt(`Executing (default): ${w} x`), w)
            assert.strictEqual(getSqlStmt(`${w.toLowerCase()} x`), w)
        }
        for (let w of ['TRUNCATE', 'MERGE', 'EXEC', 'VACUUM', 'ATTACH']) {
            assert.strictEqual(getSqlStmt(`${w} x`), 'OTHER')
        }
    })

})


describe('getSqlStmt', function() {

    it('R-DIAG-01 只取敘述種類(白名單), 不含表名與值', function() {
        assert.strictEqual(getSqlStmt(`Executing (default): SELECT * FROM t WHERE id = '${ID}'`), 'SELECT')
        assert.strictEqual(getSqlStmt('Executing (3f2c-aa): insert into t values ($1)'), 'INSERT')
        assert.strictEqual(getSqlStmt('Executing (default): CREATE TABLE IF NOT EXISTS `t` (`id` TEXT)'), 'CREATE')
        assert.strictEqual(getSqlStmt('Executing (default): PRAGMA INDEX_LIST(`t`)'), 'PRAGMA')
        assert.strictEqual(getSqlStmt('Executing (default): DELETE FROM t'), 'DELETE')
        assert.strictEqual(getSqlStmt('executing (conn): select * from t'), 'SELECT', '前綴不分大小寫(外審Flash)')
        assert.strictEqual(getSqlStmt(`Executing (default): ${ID} oops`), 'OTHER')
        assert.strictEqual(getSqlStmt('Executing (default): '), 'OTHER')
        assert.strictEqual(getSqlStmt(null), 'OTHER')
        assert.strictEqual(getSqlStmt({ a: 1 }), 'OTHER')
    })

})


describe('maskUrl 與 maskDialect', function() {

    it('R-DIAG-06 有://者一律只回<scheme>://***, @之前與之後皆不回顯(連線字串無主機: 密碼可含@, @之後可能是密碼之後半)', function() {
        let t = [
            ['mdb://u:p@db.local:1433', 'mdb://***'],
            ['mdb://u:p@ss@db.local:1433', 'mdb://***'],
            ['mdb://u:p@@db.local', 'mdb://***'],
            ['mdb://u:p@', 'mdb://***'],
            ['mdb://u:p@:1433', 'mdb://***'],
            ['mdb://u:p@db.local/db?x=1#y', 'mdb://***'],
            ['mdb://u:p@[::1]:1433', 'mdb://***'],
            ['mdb://u:p@db local', 'mdb://***'],
            ['oracle://db.local:1433@user:pass', 'oracle://***'],
            ['://u:p@db.local:1433', '://***'],
            //無主機之標準形式, 密碼或帳號含@(外審Argon探測: 舊版把@之後回顯為主機而洩漏密碼後半)
            ['mdb://admin:p@ssword123', 'mdb://***'],
            ['mdb://:MySecret@Pass123', 'mdb://***'],
            ['mdb://admin:p1:p2@Secret_Pass-99', 'mdb://***'],
            ['mdb://alice@corp.com:12345', 'mdb://***'],
            ['mdb://u@:12345', 'mdb://***'],
            ['postgres://admin:Secret@Pass123', 'postgres://***'],
            ['mdb://admin://secret@Pass123', 'mdb://***'],
            ['mdb://admin:pass@db.local://secret', 'mdb://***'],
        ]
        for (let [from, to] of t) {
            assert.strictEqual(maskUrl(from), to, from)
        }
    })

    it('R-DIAG-06 無@(本套件標準形式mdb://帳號:密碼): 只回<scheme>://***; 無://或非字串: 整段***', function() {
        assert.strictEqual(maskUrl('mdb://username:password'), 'mdb://***')
        assert.strictEqual(maskUrl('mdb://onlypw'), 'mdb://***')
        assert.strictEqual(maskUrl('mdb://:'), 'mdb://***')
        assert.strictEqual(maskUrl('://x'), '://***')
        assert.strictEqual(maskUrl('u:p@db.local:1433'), '***')
        assert.strictEqual(maskUrl('onlypw'), '***')
        assert.strictEqual(maskUrl(''), '***')
        for (let v of [undefined, null, 1, {}, [], Symbol('x')]) {
            assert.strictEqual(maskUrl(v), '***')
        }
    })

    it('R-DIAG-06 scheme須為識別字(最多20字元), 否則換成***; 第一個://之前若夾帶帳密(如u:p@host://)亦不回顯', function() {
        assert.strictEqual(maskUrl('oracle://u:p@h:1'), 'oracle://***')
        assert.strictEqual(maskUrl('a.b+c-d://u:p@h:1'), 'a.b+c-d://***')
        assert.strictEqual(maskUrl('bad scheme://u:p@h:1'), '***://***')
        assert.strictEqual(maskUrl('u:p@h://x'), '***://***')
        assert.strictEqual(maskUrl(`${'a'.repeat(21)}://u:p@h:1`), '***://***')
        assert.strictEqual(maskUrl(`${'a'.repeat(20)}://u:p@h:1`), `${'a'.repeat(20)}://***`)
    })

    it('R-DIAG-06 反向筆誤(host:port@帳號:純數字密碼)亦不回顯: 無主機之設計令舊版之已知限制(LDG1)消失', function() {
        assert.strictEqual(maskUrl('oracle://db.local:1433@user:12345'), 'oracle://***')
        assert.strictEqual(maskUrl('oracle://db.local:1433@user:pass'), 'oracle://***')
    })

    it('R-DIAG-06 maskDialect: 有://且scheme合識別字樣式者照回, 無://(整串即dialect, 可能就是帳密)、不合樣式、非字串者為***', function() {
        assert.strictEqual(maskDialect('oracle://u:p@h:1'), 'oracle')
        assert.strictEqual(maskDialect('MSSQL://x'), 'MSSQL')
        assert.strictEqual(maskDialect('a.b+c-d://x'), 'a.b+c-d')
        assert.strictEqual(maskDialect('Zonly7'), '***', '無://: 整串可能就是密碼')
        assert.strictEqual(maskDialect('u:p@h:1'), '***')
        assert.strictEqual(maskDialect('bad scheme://x'), '***')
        assert.strictEqual(maskDialect('u:p@h://x'), '***')
        assert.strictEqual(maskDialect(`${'a'.repeat(21)}://x`), '***')
        for (let v of [undefined, null, 1, {}, [], Symbol('x')]) {
            assert.strictEqual(maskDialect(v), '***')
        }
    })

    it('R-DIAG-06 組合掃描: scheme × 帳密段 × 主機段,帳密段(含QQ標記)不論夾帶 @ : / ? # 或空白,maskUrl與maskDialect之輸出皆不含QQ', function() {
        let schemes = ['mdb', 'oracle', '', 'sqlite']
        let uis = ['QQu:QQp', 'QQu', 'QQu:QQp:QQr', ':QQp', 'QQu:', 'QQp@QQs', 'QQ?x', 'QQ/x', 'QQ x', 'QQ#y', 'QQ:', ':QQ', 'QQ@@QQ']
        let hosts = ['', 'host', 'h.local:1433', ':1433', 'host:', '[::1]', 'h x', 'h/p', 'h?q=1', 'h#z', 'h@']
        let n = 0
        let forms = (sc, ui, h) => {
            let r = [`${sc}://${ui}@${h}`, `${ui}@${h}`, ui]
            if (ui.indexOf('@') < 0) {
                r.push(`${sc}://${ui}`)
            }
            return r
        }
        for (let sc of schemes) {
            for (let ui of uis) {
                for (let h of hosts) {
                    for (let s of forms(sc, ui, h)) {
                        let out = maskUrl(s)
                        let outD = maskDialect(s)
                        n++
                        assert.ok(out === '***' || out.endsWith('://***'), `輸入[${s}]輸出[${out}]之形式`)
                        assert.ok(out.indexOf('QQ') < 0, `輸入[${s}]maskUrl輸出[${out}]含帳密標記`)
                        assert.ok(outD.indexOf('QQ') < 0, `輸入[${s}]maskDialect輸出[${outD}]含帳密標記`)
                    }
                }
            }
        }
        assert.ok(n > 1500, `組合數 ${n}`)
    })

})
