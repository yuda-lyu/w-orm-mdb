import fs from 'fs'
import path from 'path'
import assert from 'assert'
import getDiag from 'wsemi/src/getDiag.mjs'
import { isOwnErr } from 'w-orm-reladb/src/ownErr.mjs'
import { importSrc, getSrcDir } from './tools/srcDir.mjs'


//spec: sgud/rule/rulebook.md 之 R-DIAG(主控dspec〈診斷輸出與遮罩〉D1～D3、wsemi之R-DIAG-01): 純函數與原始碼盤點, 不連線, 不依賴Jet(CI之ubuntu亦可跑)
//  診斷出口與遮罩之形態(文字、拷貝、對外值、摘要、出口)由wsemi之共用語料(_diagCases)於wsemi內測; 本套件之接線見unit-diaglog-wo、unit-diaglog-wire(真Jet)
//  本檔: ①原始碼盤點——診斷站點之label與safe鍵為固定詞彙(dspec D2、設計§6.7第4條)、整批reject與事件之出口必經outErr、逐筆err必經diag.mask或為固定詞彙、
//        本套件之固定詞彙錯誤皆以ownErr登記(D3: 固定詞彙不遮; 未登記者經diag.err)、無自寫之遮罩實作(D1)
//        ②套件專屬之純函數getSqlStmt、maskDialect(後者只回顯已知方言名, LDG10裁定B); ③固定詞彙之登記(ownErr)於各模組之拋錯點; ④依賴w-orm-reladb之genModelsByTabs之diag參數契約(≥1.1.18)


//code, 去除註解後之程式碼行(行首之//、JSDoc與區塊註解行, 及以空白起頭之行尾//註解)
function code(fn) {
    let r = []
    let inBlock = false
    for (let ln of fs.readFileSync(path.join(getSrcDir(), fn), 'utf8').split(/\r?\n/)) {
        let t = ln.trim()
        if (inBlock) {
            if (t.indexOf('*/') >= 0) {
                inBlock = false
            }
            continue
        }
        if (t.startsWith('/*')) {
            if (t.indexOf('*/') < 0) {
                inBlock = true
            }
            continue
        }
        if (t.startsWith('//') || t.startsWith('*')) {
            continue
        }
        r.push(ln.replace(/\s\/\/.*$/, ''))
    }
    return r
}
const fns = () => fs.readdirSync(getSrcDir()).filter((v) => v.endsWith('.mjs'))
const all = () => fns().map((fn) => ({ fn, lines: code(fn) }))


//cap, 擷取console各方法之輸出(原引數)
function cap(fn) {
    let lines = []
    let ks = ['log', 'info', 'warn', 'error', 'debug']
    let olds = ks.map((k) => console[k])
    ks.forEach((k) => {
        console[k] = (...a) => lines.push({ k, a })
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


describe('原始碼盤點(R-DIAG-00、R-DIAG-09)', function() {

    it('單一實作(D1): src無自寫之診斷出口與遮罩——無getDiag.mjs, 無maskText、cpMask、getSecrets、getBriefErr、maskUrl、getOptLog之定義', function() {
        assert.ok(!fns().includes('getDiag.mjs'))
        let hits = []
        for (let { fn, lines } of all()) {
            lines.forEach((ln, k) => {
                if (/\b(function\s+|(let|const|var)\s+)(maskText|cpMask|getSecrets|getBriefErr|maskUrl|getOptLog|maskSafe|swallow)\b/.test(ln)) {
                    hits.push(`${fn}#${k}: ${ln.trim()}`)
                }
            })
        }
        assert.deepStrictEqual(hits, [])
    })

    it('診斷站點全集: src內diag(…)恰3處, label為字串字面值(sql、change handler threw、error handler threw), safe之鍵為宣告之識別字, 無第4引數(皆寫console.log)', function() {
        let sites = []
        for (let { fn, lines } of all()) {
            lines.forEach((ln) => {
                if (/\bdiag\s*\(/.test(ln)) {
                    sites.push({ fn, ln: ln.trim() })
                }
            })
        }
        let re = /^diag\('([^']*)', \{ ([^}]*) \}, \(\) => (\w+)\)$/
        let got = sites.map(({ fn, ln }) => {
            let m = ln.match(re)
            assert.ok(m !== null, `${fn}: 站點形式不合(label須為字面值, safe為物件字面值, 第3引數為()=>變數, 無第4引數): ${ln}`)
            return [fn, m[1], m[2]]
        })
        assert.deepStrictEqual(got, [
            ['WOrmMdb.mjs', 'sql', 'stmt: getSqlStmt(sql)'],
            ['WOrmMdb.mjs', 'change handler threw', 'mode, ...diag.brief(err)'],
            ['WOrmMdb.mjs', 'error handler threw', 'mode, ...diag.brief(errEmit)'],
        ])
    })

    it('safe之鍵白名單: SAFE_KEYS為stmt、mode、name、type(name、type為w-orm-reladb之genModelsByTabs之diag參數契約所需), getDiag之cfg宣告之', function() {
        let c = code('WOrmMdb.mjs').join('\n')
        assert.ok(/^const SAFE_KEYS = \['stmt', 'mode', 'name', 'type'\]$/m.test(c), 'SAFE_KEYS')
        assert.ok(/let diag = getDiag\(opt, \{\s*secrets: getDiagSecrets\(\{ urls: \[opt\.url\], username, password, paths: \[storageRaw, path\.normalize\(storageRaw\), opt\.storage\] \}\),\s*patterns: \['mdbUrl'\],\s*safeKeys: SAFE_KEYS,\s*\}\)/.test(c), 'getDiag之cfg宣告(secrets、patterns、safeKeys)')
        assert.ok(/maskDiagUrl\(opt\.url, \{ schemes: SCHEMES \}\)/.test(c) && /^const SCHEMES = \['mdb'\]$/m.test(c), 'throwUrlErr經maskDiagUrl(schemes mdb)')
    })

    it('整批reject與error事件之出口: 七函數之catch皆res = outErr(err, si)、預檢與createStorage之catch皆let e = outErr(err), WOrmMdb之Promise.reject只交出已處置之值', function() {
        let c = code('WOrmMdb.mjs')
        assert.strictEqual(c.filter((ln) => ln.trim() === 'res = outErr(err, si)').length, 7, '七函數之整批catch')
        assert.strictEqual(c.filter((ln) => ln.trim() === 'let e = outErr(err)').length, 5, 'insert、insertBulk、save、del之預檢catch與createStorage之catch')
        let rejects = c.filter((ln) => /Promise\.reject\(/.test(ln)).map((ln) => ln.trim())
        let bad = rejects.filter((ln) => !['return Promise.reject(res)', 'return Promise.reject(e)', 'return Promise.reject(err)', 'return Promise.reject(diag.err(err))'].includes(ln))
        assert.deepStrictEqual(bad, [])
        //return Promise.reject(err)只用於固定詞彙之err(ownErr(msg)), 恰2處(insert、insertBulk之預檢不合格)
        let ownRej = c.filter((ln) => /let err = ownErr\(msg\)/.test(ln))
        assert.strictEqual(ownRej.length, 2)
        assert.strictEqual(rejects.filter((ln) => ln === 'return Promise.reject(err)').length, 2)
        //error事件之訊息與reject同源: emitError之第3引數為res、e、err(固定詞彙)或逐筆之v.err
        let ems = c.filter((ln) => /emitError\(/.test(ln) && !/function emitError/.test(ln)).map((ln) => ln.trim().match(/emitError\([^,]+, [^,]+, ([^)]+)\)/)[1])
        assert.deepStrictEqual([...new Set(ems)].sort(), ['e', 'err', 'res', 'v.err'])
    })

    it('逐筆結果之err: 皆為固定詞彙(字面值、chkWf之訊息m)或建立時即遮之Jet錯誤文字(getJetErrMsg、diag.mask), 無未遮之getErrMsg', function() {
        let errs = code('WOrmMdb.mjs').filter((ln) => /^\s*err: /.test(ln)).map((ln) => ln.trim())
        let bad = errs.filter((ln) => !(/^err: (`[^`]*`|'[^']*'),$/.test(ln) || ln === 'err: m,' || /^err: getJetErrMsg\(rr, '[a-z ]+'\),$/.test(ln) || ln === 'err: diag.mask(getErrMsg(rr.error)),'))
        assert.deepStrictEqual(bad, [])
        assert.strictEqual(errs.filter((ln) => /getJetErrMsg|diag\.mask/.test(ln)).length, 3, 'save之預讀、寫入, del之刪除')
    })

    it('固定詞彙之登記: src之new Error(…)只用於Jet引擎之錯誤文字(外來值, 未登記而經diag.err)與建構期之拋錯; 其餘本套件之訊息皆經ownErr', function() {
        let hits = []
        for (let { fn, lines } of all()) {
            lines.forEach((ln) => {
                let ms = ln.match(/new (Type)?Error\(([^)]*)/g) || []
                for (let m of ms) {
                    let arg = m.replace(/^new (Type)?Error\(/, '')
                    if (/^[\w.]+\.error$/.test(arg)) {
                        continue //Jet之錯誤文字(外來值)
                    }
                    hits.push(`${fn}: ${m}`)
                }
            })
        }
        //建構期(throwUrlErr、opt之型別與良構)之同步拋錯為固定詞彙且不經outErr; importModels之invalid fields只於模組內被pm2resolve收下, 不成為對外值
        /* eslint-disable no-template-curly-in-string */ //預期值為原始碼之字面文字
        assert.deepStrictEqual(hits.sort(), [
            'WOrmMdb.mjs: new Error(`${msg}, opt.url[${maskDiagUrl(opt.url, { schemes: SCHEMES }',
            'WOrmMdb.mjs: new Error(`invalid opt.${k}: ${why}`',
            'WOrmMdb.mjs: new TypeError(\'invalid opt: not an object\'',
            'importModels.mjs: new Error(\'invalid fields\'',
        ].sort())
        /* eslint-enable no-template-curly-in-string */
    })

    it('外來值之其他站點: snap之複製失敗、initAdodb之sequelize建立或關閉失敗皆經diag.err, normFind之cvOrmFind錯誤以markOwnErr登記', function() {
        let c = code('WOrmMdb.mjs').map((ln) => ln.trim())
        assert.ok(c.includes('return Promise.reject(diag.err(err))'), 'snap')
        assert.ok(c.includes('err = e === getImportErr(opt) ? e : diag.err(getErrMsg(e))'), 'initAdodb之initSequelize失敗')
        assert.ok(c.includes('throw diag.err(e)'), 'initAdodb之close')
        assert.ok(c.includes('throw markOwnErr(err)'), 'normFind')
    })

})


describe('getSqlStmt(自舊getDiag.mjs移入src/getSqlStmt.mjs)', function() {

    let getSqlStmt = null
    before(async function() {
        getSqlStmt = (await importSrc('getSqlStmt.mjs')).default
    })

    it('R-DIAG-01 只取敘述種類(白名單), 不含表名與值', function() {
        assert.strictEqual(getSqlStmt('Executing (default): SELECT * FROM t WHERE id = \'u-secret-001@example.com\''), 'SELECT')
        assert.strictEqual(getSqlStmt('Executing (3f2c-aa): insert into t values ($1)'), 'INSERT')
        assert.strictEqual(getSqlStmt('Executing (default): CREATE TABLE IF NOT EXISTS `t` (`id` TEXT)'), 'CREATE')
        assert.strictEqual(getSqlStmt('Executing (default): PRAGMA INDEX_LIST(`t`)'), 'PRAGMA')
        assert.strictEqual(getSqlStmt('Executing (default): DELETE FROM t'), 'DELETE')
        assert.strictEqual(getSqlStmt('executing (conn): select * from t'), 'SELECT', '前綴不分大小寫')
        assert.strictEqual(getSqlStmt('Executing (default): u-secret-001@example.com oops'), 'OTHER')
        assert.strictEqual(getSqlStmt('Executing (default): '), 'OTHER')
        assert.strictEqual(getSqlStmt(null), 'OTHER')
        assert.strictEqual(getSqlStmt({ a: 1 }), 'OTHER')
    })

    it('R-DIAG-01 白名單之全部敘述種類(含小寫)皆辨識, 其餘為OTHER', function() {
        for (let w of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'WITH']) {
            assert.strictEqual(getSqlStmt(`Executing (default): ${w} x`), w)
            assert.strictEqual(getSqlStmt(`${w.toLowerCase()} x`), w)
        }
        for (let w of ['TRUNCATE', 'MERGE', 'EXEC', 'VACUUM', 'ATTACH']) {
            assert.strictEqual(getSqlStmt(`${w} x`), 'OTHER')
        }
    })

})


describe('maskDialect(本套件專屬, src/maskDialect.mjs; R-DIAG-06 LDG10裁定B: 只回顯已知方言名)', function() {

    let maskDialect = null
    before(async function() {
        maskDialect = (await importSrc('maskDialect.mjs')).default
    })

    //裁定1: 白名單 mdb、mssql、sqlite、mysql、mariadb、postgres, 比對不分大小寫, 回顯宣告之小寫形
    const NAMES = ['mdb', 'mssql', 'sqlite', 'mysql', 'mariadb', 'postgres']

    it('白名單各名(逐名): 有://且://之前等於該名者回顯該名', function() {
        for (let nm of NAMES) {
            assert.strictEqual(maskDialect(`${nm}://u:p@h:1`), nm, nm)
            assert.strictEqual(maskDialect(`${nm}://`), nm, `${nm} 無其後內容`)
        }
    })

    it('不分大小寫, 一律回顯宣告之小寫形(不回顯輸入之寫法)', function() {
        for (let nm of NAMES) {
            for (let v of [nm.toUpperCase(), nm[0].toUpperCase() + nm.slice(1), nm.split('').map((c, i) => (i % 2 ? c : c.toUpperCase())).join('')]) {
                assert.strictEqual(maskDialect(`${v}://x`), nm, v)
            }
        }
        assert.strictEqual(maskDialect('MSSQL://x'), 'mssql')
        assert.strictEqual(maskDialect('MariaDB://x'), 'mariadb')
    })

    it('白名單以外一律***: 未知方言、看似scheme之秘密(語料R13型)、近似名、含空白或其他字元者', function() {
        for (let v of ['oracle://u:p@h:1', 'a.b+c-d://x', 'myPasswordXYZ://h', 'Zsch9secret://h', 'postgresql://x', 'mdb2://x', 'mdbx://x', 'xmdb://x', 'mssq://x', 'sqlite3://x', 'my sql://x', ' mdb://x', 'mdb ://x', 'mdb\n://x', 'bad scheme://x', 'u:p@h://x', `${'a'.repeat(21)}://x`, `${'a'.repeat(20)}://x`, '://x', 'mdb.://x', 'mdb:/x://y']) {
            assert.strictEqual(maskDialect(v), '***', v)
        }
        //近似名之Unicode大小寫摺疊(如長s、Kelvin符號)不使其等同白名單名, 且輸出為字面值***
        assert.strictEqual(maskDialect('mysql\u212A://x'), '***')
        assert.strictEqual(maskDialect('\u017Fqlite://x'), '***')
    })

    it('無://(整串即dialect, 可能就是帳密)、非字串者為***, 即使整串恰為白名單名', function() {
        assert.strictEqual(maskDialect('Zonly7'), '***', '無://: 整串可能就是密碼')
        assert.strictEqual(maskDialect('u:p@h:1'), '***')
        assert.strictEqual(maskDialect('mdb'), '***', '無://: 整串可能就是密碼, 即使恰為方言名')
        assert.strictEqual(maskDialect('postgres'), '***')
        assert.strictEqual(maskDialect(''), '***')
        for (let v of [undefined, null, 1, true, {}, [], ['mdb://x'], { toString: () => 'mdb://x' }, Symbol('x')]) {
            assert.strictEqual(maskDialect(v), '***')
        }
    })

    it('只看第一個://之前: 其後夾帶 :// 或白名單名者不改變結果', function() {
        assert.strictEqual(maskDialect('mdb://postgres://x'), 'mdb')
        assert.strictEqual(maskDialect('Zsch9secret://mdb://x'), '***')
        assert.strictEqual(maskDialect('u:p@mdb://x'), '***')
    })

    it('組合掃描: scheme × 帳密段 × 主機段, 帳密段(含QQ標記)不論夾帶 @ : / ? # 或空白, 輸出皆不含QQ; 輸出只可能是白名單名或***', function() {
        let schemes = ['mdb', 'oracle', '', 'sqlite', 'QQsch', 'QQ', 'MDB', 'Postgres']
        let uis = ['QQu:QQp', 'QQu', 'QQu:QQp:QQr', ':QQp', 'QQu:', 'QQp@QQs', 'QQ?x', 'QQ/x', 'QQ x', 'QQ#y', 'QQ:', ':QQ', 'QQ@@QQ']
        let hosts = ['', 'host', 'h.local:1433', ':1433', 'host:', '[::1]', 'h x', 'h/p', 'h?q=1', 'h#z', 'h@']
        let n = 0
        for (let sc of schemes) {
            for (let ui of uis) {
                for (let h of hosts) {
                    for (let s of [`${sc}://${ui}@${h}`, `${ui}@${h}`, ui, `${sc}://${ui}`]) {
                        let out = maskDialect(s)
                        n++
                        assert.ok(out.indexOf('QQ') < 0, `輸入[${s}]輸出[${out}]含帳密標記`)
                        assert.ok(out === '***' || NAMES.includes(out), `輸入[${s}]輸出[${out}]不是白名單名或***`)
                    }
                }
            }
        }
        assert.ok(n > 2000, `組合數 ${n}`)
    })

})


describe('固定詞彙之登記(ownErr, 各模組之拋錯點; R-DIAG: 登記者原樣交出, 未登記者經diag.err)', function() {

    it('getCmd: 識別字與字串值之孤立代理、越界日期之拋錯已登記', async function() {
        let { getInsert, getSelectAll } = await importSrc('getCmd.mjs')
        let es = []
        let d10 = new Date(2000, 0, 1)
        d10.setFullYear(10) //本地年10(new Date(10, …)會被視為1910)
        for (let f of [() => getSelectAll('t\uD800'), () => getInsert('t', ['id'], { id: 'a\uD800' }), () => getInsert('t', ['d'], { d: d10 })]) {
            try {
                f()
                es.push(null)
            }
            catch (err) {
                es.push(err)
            }
        }
        assert.deepStrictEqual(es.map((e) => e && e.message), ['invalid identifier: string contains lone surrogate', 'invalid data: string contains lone surrogate', 'invalid data: date is not a valid time in years 100-9999'])
        assert.deepStrictEqual(es.map((e) => isOwnErr(e)), [true, true, true])
    })

    it('pk: castPkFind之否定語境無效主鍵值、queryMemory: chkFindColKind之非白名單欄型之拋錯已登記', async function() {
        let { castPkFind } = await importSrc('pk.mjs')
        let { chkFindColKind } = await importSrc('queryMemory.mjs')
        let e1 = null
        try {
            castPkFind({ id: { $ne: '' } }, 'id', 'str', '_wi')
        }
        catch (err) {
            e1 = err
        }
        assert.ok(e1 !== null && /^invalid find: invalid primary key value in negative condition/.test(e1.message) && isOwnErr(e1), String(e1))
        let e2 = null
        try {
            chkFindColKind({ t: { type: { key: 'TIME' } } }, { t: '10:00:00' })
        }
        catch (err) {
            e2 = err
        }
        assert.ok(e2 !== null && e2.message === 'invalid find: column type TIME is not supported at [find.t]' && isOwnErr(e2), String(e2))
    })

    it('固定詞彙之字串訊息: 匯入失敗(getImportErr)、ERR_NOT_ARR、ERR_NO_RES為固定形式', async function() {
        let { getImportErr, ERR_NOT_ARR } = await importSrc('queryMemory.mjs')
        let { ERR_NO_RES } = await importSrc('jet.mjs')
        assert.strictEqual(getImportErr({ cl: 'tb', modelType: 'js' }), 'can not import model: tb, need to use genModelsByDB, genModelsByTabs or create tb.js')
        assert.strictEqual(ERR_NOT_ARR, 'data is not an array')
        assert.strictEqual(ERR_NO_RES, 'connMDB.exe did not produce result file')
    })

})


describe('依賴w-orm-reladb之genModelsByTabs之diag參數契約(R-DIAG-05; ≥1.1.18: 第4參數須為wsemi之getDiag實例, 只以固定標籤呼叫, safe之鍵name、type)', function() {

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
    const MIN = '1.1.18'

    before(function() {
        fs.rmSync(fdDep, { recursive: true, force: true })
    })

    after(function() {
        fs.rmSync(fdDep, { recursive: true, force: true })
    })

    it('依賴版本下限: package.json之w-orm-reladb下限與已安裝版本皆≥1.1.18(其genModelsByTabs之diag參數契約為wsemi之getDiag實例)', function() {
        let pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
        let range = pkg.dependencies['w-orm-reladb']
        assert.ok(geVer(ver(range), ver(MIN)), `package.json之w-orm-reladb下限[${range}]低於${MIN}`)
        let inst = JSON.parse(fs.readFileSync('./node_modules/w-orm-reladb/package.json', 'utf8')).version
        assert.ok(geVer(ver(inst), ver(MIN)), `已安裝w-orm-reladb[${inst}]低於${MIN}`)
        assert.ok(geVer(ver(pkg.dependencies.wsemi), ver('1.9.31')), `wsemi下限[${pkg.dependencies.wsemi}]低於1.9.31(診斷共用模組)`)
    })

    it('以wsemi之getDiag實例(safeKeys含name、type)為第4引數: 預設只輸出(標籤, {name,type[,errType,errCode]}), funLog收(label, safe, detail)且不寫console; safeKeys未含name、type者其鍵被丟棄', async function() {
        let { default: rl } = await import('w-orm-reladb/src/genModelsByTabs.mjs')
        let run = (diag) => {
            rl(fdDep, tabs('tdep'), { type: 'js' }, diag)
            rl(fdDep, badTabs, { type: 'js' }, diag)
        }
        let l1 = cap(() => run(getDiag({}, { safeKeys: ['stmt', 'mode', 'name', 'type'] })))
        assert.deepStrictEqual(l1.map((l) => [l.k, l.a[0], l.a.length]), [['log', 'generate file:', 2], ['log', 'save file catch', 2]])
        assert.deepStrictEqual(l1[0].a[1], { name: 'tdep', type: 'js' })
        assert.deepStrictEqual({ name: l1[1].a[1].name, type: l1[1].a[1].type }, { name: 'bad|name', type: 'js' })
        let got = []
        let l2 = cap(() => run(getDiag({ funLog: (...a) => got.push(a) }, { safeKeys: ['name', 'type'] })))
        assert.deepStrictEqual(l2, [])
        assert.deepStrictEqual(got.map((a) => [a[0], a.length]), [['generate file:', 3], ['save file catch', 3]])
        assert.ok(String(got[0][2]).indexOf('tdep.js') >= 0)
        assert.ok(got[1][2] instanceof Error)
        let l3 = cap(() => run(getDiag({}, {})))
        assert.strictEqual(l3.length, 2)
        for (let l of l3) {
            let sf = l.a[1]
            assert.ok(sf === undefined || (!Object.prototype.hasOwnProperty.call(sf, 'name') && !Object.prototype.hasOwnProperty.call(sf, 'type')), `safeKeys未宣告name、type者, 其鍵應被丟棄: ${JSON.stringify(sf)}`)
        }
    })

    it('不合契約之第4引數(一般函數)不被呼叫, 依賴改用其預設出口(故本套件須傳wsemi之getDiag實例)', async function() {
        let { default: rl } = await import('w-orm-reladb/src/genModelsByTabs.mjs')
        let calls = []
        let lines = cap(() => {
            rl(fdDep, tabs('tdep3'), { type: 'js' }, (...a) => calls.push(a))
        })
        assert.deepStrictEqual(calls, [])
        assert.deepStrictEqual(lines.map((l) => l.a[0]), ['generate file:'])
    })

})
