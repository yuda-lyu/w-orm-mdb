import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { isWindows } from './unit-setup.mjs'
import ensureBins from '../src/ensureBins.mjs'
import wo from '../src/WOrmMdb.mjs'


//規格: 外部執行檔之存放下載校驗與離線(制式規格, C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md) D1~D4、O1~O3、E2、§8 T3~T7(T8為主幹模式, 本套件為釘選模式不適用)
//以本機HTTP伺服器扮GitHub(raw.githubusercontent.com)與HTTP鏡像, 以本地資料夾扮鏡像, 全程不連外網; 下載與校驗之細節由wsemi之測試涵蓋, 本檔驗本套件接線:
//  清單(bin/manifest.json)與釘選網址、快取位置、環境變數、離線錯誤格式, 以及jet.mjs經ensureBins取得執行檔並實際執行
//註: 取得流程不執行exe故與平台無關; 整合案例(實際執行exe)僅Windows


let nm = 'ensurebins'
let fdt = `./test/temp-${nm}`
let PORT = 8741 //固定埠(≥8000, 不隨機), 本專案其他測試未用

let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
let ent = manifest.files[0]
let bytes = fs.readFileSync(ent.path)
let sha = ent.sha256
let base = `http://127.0.0.1:${PORT}`

//flip, 同大小但內容不同之位元組
let flip = (b) => {
    let c = Buffer.from(b)
    c[100] = c[100] ^ 0xff
    return c
}

//listFiles, 遞迴列出資料夾內所有檔(相對路徑, 斜線分隔)
let listFiles = (fd) => {
    let rs = []
    let walk = (d, pre) => {
        if (!fs.existsSync(d)) {
            return
        }
        for (let n of fs.readdirSync(d)) {
            let fp = path.join(d, n)
            if (fs.statSync(fp).isDirectory()) {
                walk(fp, `${pre}${n}/`)
            }
            else {
                rs.push(`${pre}${n}`)
            }
        }
    }
    walk(fd, '')
    return rs.sort()
}

//扮GitHub之fetch: 將raw.githubusercontent.com改指本機伺服器
let fetchLocal = (url, init) => {
    return globalThis.fetch(String(url).replace('https://raw.githubusercontent.com', base), init)
}

//不得連網之fetch, 被呼叫即失敗
let fetchNever = () => {
    throw new Error('network must not be used')
}

//取得結果之錯誤
let getErr = async (pm) => {
    try {
        await pm
        return null
    }
    catch (err) {
        return err
    }
}

//本機伺服器: GET /<repo>/<commit>/<path> 扮GitHub, GET /mirror/<pkg>/<sha>/<name> 扮HTTP鏡像
let mode = 'ok' // ok | same-size | short | e404
let hits = []
let server = null

//子行程以env覆寫三個環境變數(未給者刪除), 其餘繼承
let envOf = (ext = {}) => {
    let env = { ...process.env }
    for (let k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE']) {
        delete env[k]
    }
    return { ...env, ...ext }
}

//子行程以ESM執行code(內嵌字串, 與本系列其他套件之跨行程測試同慣例), 回傳其stdout最後一行之JSON
let runChild = (code, ext = {}, cwd = fdt) => {
    let r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: path.resolve(cwd), env: envOf(ext), encoding: 'utf8', timeout: 120000, windowsHide: true })
    let lines = String(r.stdout || '').trim().split('\n')
    let m = null
    try {
        m = JSON.parse(lines[lines.length - 1])
    }
    catch (err) {}
    assert.strict.ok(m !== null, `子行程無JSON輸出: status=${r.status} stderr=${String(r.stderr || '').slice(0, 600)}`)
    return m
}

let urlEnsure = pathToFileURL(path.resolve('src/ensureBins.mjs')).href
let urlJet = pathToFileURL(path.resolve('src/jet.mjs')).href

//CHILD_ENSURE, 無任何選項呼叫ensureBins(環境變數驅動)
let CHILD_ENSURE = `
import ensureBins from ${JSON.stringify(urlEnsure)}
let o = {}
try {
    o = { ok: true, bins: await ensureBins() }
}
catch (err) {
    o = { ok: false, code: err.code, message: String(err.message), missing: err.missing || null }
}
console.log(JSON.stringify(o))
`

//CHILD_JET, 自他處之工作目錄以jet.mjs對mdb副本寫入一列並讀回
let CHILD_JET = `
import jetOpen from ${JSON.stringify(urlJet)}
let o = {}
try {
    let jet = jetOpen({ path: process.env.T_MDB, password: '' })
    await jet.execute("INSERT INTO [users] ([id], [name], [value]) VALUES ('a1', 'n1', 1.5)")
    o = { ok: true, rows: await jet.query('SELECT * FROM [users]') }
}
catch (err) {
    o = { ok: false, code: err && err.code, message: String(err && err.message || err) }
}
console.log(JSON.stringify(o))
`


describe(`ensureBins (外部執行檔connMDB.exe之取得, 制式規格§8 T3~T7)`, function() {
    this.timeout(120000)

    before(async function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
        server = http.createServer((req, res) => {
            hits.push(req.url)
            let isGithub = req.url === `/${manifest.repo}/${manifest.commit}/${ent.path}`
            let isMirror = req.url === `/mirror/${manifest.pkg}/${sha}/${ent.name}`
            if (!isGithub && !isMirror) {
                res.writeHead(404)
                res.end('not found')
                return
            }
            let body = bytes
            if (isGithub) {
                if (mode === 'e404') {
                    res.writeHead(404)
                    res.end('not found')
                    return
                }
                if (mode === 'same-size') {
                    body = flip(bytes)
                }
                else if (mode === 'short') {
                    body = bytes.subarray(0, bytes.length - 10)
                }
            }
            res.writeHead(200, { 'content-length': String(body.length) })
            res.end(body)
        })
        await new Promise((resolve, reject) => {
            server.once('error', reject)
            server.listen(PORT, '127.0.0.1', resolve)
        })
    })

    after(async function() {
        await new Promise((resolve) => {
            server.close(resolve)
            server.closeAllConnections()
        })
        fs.rmSync(fdt, { recursive: true, force: true })
    })

    beforeEach(function() {
        mode = 'ok'
        hits = []
    })

    it(`should export ensureBins as a function and attach it to the default export (D1, E2③)`, function() {
        assert.strict.equal(typeof ensureBins, 'function')
        assert.strict.equal(wo.ensureBins, ensureBins)
    })

    it(`T3: should download from the pinned commit URL on first use, verify, cache, then not use the network on the second call (D1, D3, D4, M2)`, async function() {
        let cacheDir = `${fdt}/t3`
        let r = await ensureBins({ names: 'connMDB.exe', cacheDir, mirror: '', offline: false, fetch: fetchLocal, maxAttempts: 1 })
        let fp = path.join(path.resolve(cacheDir), sha, 'connMDB.exe')
        assert.strict.deepStrictEqual(Object.keys(r), ['connMDB.exe'])
        assert.strict.equal(path.resolve(r['connMDB.exe']), fp, '快取位置須為<快取>/<sha256>/<name>(D3)')
        assert.strict.ok(fs.readFileSync(fp).equals(bytes))
        //網址釘選到清單之提交, 非master(M2、U1)
        assert.strict.deepStrictEqual(hits, [`/${manifest.repo}/${manifest.commit}/bin/connMDB.exe`])
        assert.strict.deepStrictEqual(listFiles(cacheDir), [`${sha}/connMDB.exe`], '快取只存最終檔, 不留暫存')

        //第二次: 快取命中(校驗通過)不連網
        let r2 = await ensureBins({ names: 'connMDB.exe', cacheDir, mirror: '', offline: false, fetch: fetchNever })
        assert.strict.equal(path.resolve(r2['connMDB.exe']), fp)
        assert.strict.equal(hits.length, 1)
    })

    it(`T4: should reject and leave no file when the downloaded bytes differ in content or size (M2, D2)`, async function() {
        for (let [m, code] of [['same-size', 'E_HASH_MISMATCH'], ['short', 'E_SIZE_MISMATCH']]) {
            mode = m
            let cacheDir = `${fdt}/t4-${m}`
            let err = await getErr(ensureBins({ cacheDir, mirror: '', offline: false, fetch: fetchLocal, maxAttempts: 1, retryDelayMs: 1 }))
            assert.strict.equal(err && err.code, code, `${m}: ${err && err.message}`)
            assert.strict.deepStrictEqual(listFiles(cacheDir), [], `${m}: 不符者不得留檔`)
        }
    })

    it(`T5: should take the file from a local-folder mirror, and refuse a tampered mirror file (O1, O2, O3)`, async function() {
        let mirror = `${fdt}/t5-mirror`
        fs.mkdirSync(`${mirror}/${manifest.pkg}/${sha}`, { recursive: true })
        let fpMirror = `${mirror}/${manifest.pkg}/${sha}/connMDB.exe`
        fs.writeFileSync(fpMirror, bytes)

        //自鏡像取得: 全離線(offline:true且fetch被呼叫即失敗), 內容正確, 落在快取
        let cacheDir = `${fdt}/t5-cache`
        let r = await ensureBins({ cacheDir, mirror, offline: true, fetch: fetchNever })
        assert.strict.ok(fs.readFileSync(r['connMDB.exe']).equals(bytes))
        assert.strict.equal(path.resolve(r['connMDB.exe']), path.join(path.resolve(cacheDir), sha, 'connMDB.exe'))
        assert.strict.equal(hits.length, 0)

        //鏡像檔被竄改(同大小): 離線時拒用且不留檔 → E_OFFLINE_MISSING
        fs.writeFileSync(fpMirror, flip(bytes))
        let cache2 = `${fdt}/t5-cache2`
        let err = await getErr(ensureBins({ cacheDir: cache2, mirror, offline: true, fetch: fetchNever }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.deepStrictEqual(listFiles(cache2), [])

        //鏡像檔被竄改: 可連網時拒用鏡像、續找下一來源(GitHub)取得正確檔
        let cache3 = `${fdt}/t5-cache3`
        let r3 = await ensureBins({ cacheDir: cache3, mirror, offline: false, fetch: fetchLocal, maxAttempts: 1 })
        assert.strict.ok(fs.readFileSync(r3['connMDB.exe']).equals(bytes))
        assert.strict.equal(hits.length, 1)
    })

    it(`T5b: should take the file from an http mirror (O1)`, async function() {
        let cacheDir = `${fdt}/t5b`
        let r = await ensureBins({ cacheDir, mirror: `${base}/mirror`, offline: false, maxAttempts: 1 })
        assert.strict.ok(fs.readFileSync(r['connMDB.exe']).equals(bytes))
        //只連鏡像, 不連GitHub網址
        assert.strict.deepStrictEqual(hits, [`/mirror/${manifest.pkg}/${sha}/connMDB.exe`])
    })

    it(`T6: should reject with E_OFFLINE_MISSING naming the file, sha256, size and the cache path when offline with no cache and no mirror (O3)`, async function() {
        let cacheDir = `${fdt}/t6`
        let err = await getErr(ensureBins({ cacheDir, mirror: '', offline: true, fetch: fetchNever }))
        let fp = path.join(path.resolve(cacheDir), sha, 'connMDB.exe')
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.equal(err.missing.length, 1)
        assert.strict.equal(err.missing[0].name, 'connMDB.exe')
        assert.strict.equal(err.missing[0].sha256, sha)
        assert.strict.equal(err.missing[0].size, ent.size)
        assert.strict.equal(path.resolve(err.missing[0].cachePath), fp)
        for (let s of ['connMDB.exe', sha, String(ent.size), fp]) {
            assert.strict.ok(err.message.includes(s), `訊息須含: ${s}`)
        }
        assert.strict.deepStrictEqual(listFiles(cacheDir), [])
        assert.strict.equal(hits.length, 0)
    })

    it(`T7: should not return a tampered cache file and should obtain it again (D4)`, async function() {
        let mirror = `${fdt}/t7-mirror`
        fs.mkdirSync(`${mirror}/${manifest.pkg}/${sha}`, { recursive: true })
        fs.writeFileSync(`${mirror}/${manifest.pkg}/${sha}/connMDB.exe`, bytes)
        let cacheDir = `${fdt}/t7`
        let r = await ensureBins({ cacheDir, mirror, offline: true, fetch: fetchNever })
        let fp = r['connMDB.exe']

        //同大小竄改 → 重新自鏡像取得
        fs.writeFileSync(fp, flip(bytes))
        let r2 = await ensureBins({ cacheDir, mirror, offline: true, fetch: fetchNever })
        assert.strict.ok(fs.readFileSync(r2['connMDB.exe']).equals(bytes), '同大小竄改後須還原')

        //不同大小竄改 → 重新取得
        fs.writeFileSync(fp, Buffer.from('MZ'))
        let r3 = await ensureBins({ cacheDir, mirror, offline: true, fetch: fetchNever })
        assert.strict.ok(fs.readFileSync(r3['connMDB.exe']).equals(bytes), '截短竄改後須還原')

        //竄改且無鏡像: 不得回傳該檔, 離線缺檔
        fs.writeFileSync(fp, flip(bytes))
        let err = await getErr(ensureBins({ cacheDir, mirror: '', offline: true, fetch: fetchNever }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.ok(!fs.existsSync(fp), '不符之快取檔須刪除')
    })

    it(`should read W_BIN_CACHE, W_BIN_MIRROR and W_BIN_OFFLINE from the environment when no option is given (D3, O1, O3, E1)`, function() {
        let mirror = path.resolve(`${fdt}/env-mirror`)
        fs.mkdirSync(`${mirror}/${manifest.pkg}/${sha}`, { recursive: true })
        fs.writeFileSync(`${mirror}/${manifest.pkg}/${sha}/connMDB.exe`, bytes)
        let cache = path.resolve(`${fdt}/env-cache`)

        //三者皆設: 自鏡像取得, 快取為<W_BIN_CACHE>/<套件>/<sha256>/<name>(跨套件共用結構)
        let o = runChild(CHILD_ENSURE, { W_BIN_CACHE: cache, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' })
        assert.strict.equal(o.ok, true, JSON.stringify(o))
        assert.strict.equal(path.resolve(o.bins['connMDB.exe']), path.join(cache, manifest.pkg, sha, 'connMDB.exe'))
        assert.strict.ok(fs.readFileSync(o.bins['connMDB.exe']).equals(bytes))

        //只設離線與空快取: E_OFFLINE_MISSING
        let o2 = runChild(CHILD_ENSURE, { W_BIN_CACHE: path.resolve(`${fdt}/env-cache2`), W_BIN_OFFLINE: '1' })
        assert.strict.equal(o2.ok, false)
        assert.strict.equal(o2.code, 'E_OFFLINE_MISSING', o2.message)
        assert.strict.ok(o2.message.includes(path.join(path.resolve(`${fdt}/env-cache2`), manifest.pkg, sha, 'connMDB.exe')))
    })

    //整合: 實際執行exe, 僅Windows
    ;(isWindows() ? describe : describe.skip)(`jet.mjs obtains the executable through ensureBins and runs it`, function() {

        let fdJet = `${fdt}/jet`

        before(function() {
            fs.mkdirSync(`${fdJet}/tmpdir`, { recursive: true })
            fs.copyFileSync('./test/assets/worm_def.mdb', `${fdJet}/x.mdb`)
            let mirror = `${fdJet}/mirror/${manifest.pkg}/${sha}`
            fs.mkdirSync(mirror, { recursive: true })
            fs.writeFileSync(`${mirror}/connMDB.exe`, bytes)
        })

        it(`should run from a foreign working directory using the exe obtained from the mirror, with scratch files in the OS temp folder and none left in the cache (D3, E2②)`, function() {
            let cache = path.resolve(`${fdJet}/cache`)
            let tmpdir = path.resolve(`${fdJet}/tmpdir`)
            let o = runChild(CHILD_JET, {
                W_BIN_CACHE: cache,
                W_BIN_MIRROR: path.resolve(`${fdJet}/mirror`),
                W_BIN_OFFLINE: '1',
                T_MDB: path.resolve(`${fdJet}/x.mdb`),
                TEMP: tmpdir,
                TMP: tmpdir,
            }, os.tmpdir()) //cwd非套件根(舊版依cwd尋找exe, 於此處必失敗)
            assert.strict.equal(o.ok, true, JSON.stringify(o))
            assert.strict.deepStrictEqual(o.rows, [{ id: 'a1', name: 'n1', value: 1.5 }])
            assert.strict.deepStrictEqual(listFiles(path.join(cache, manifest.pkg)), [`${sha}/connMDB.exe`], '快取內只有執行檔, 中介檔不寫在快取')
            assert.strict.deepStrictEqual(listFiles(tmpdir), [], '中介檔用畢須刪除')
        })

        it(`should reject with E_OFFLINE_MISSING before running anything when the exe is unavailable (O3, E3)`, function() {
            fs.copyFileSync('./test/assets/worm_def.mdb', `${fdJet}/y.mdb`)
            let o = runChild(CHILD_JET, {
                W_BIN_CACHE: path.resolve(`${fdJet}/cache-empty`),
                W_BIN_OFFLINE: '1',
                T_MDB: path.resolve(`${fdJet}/y.mdb`),
            }, os.tmpdir())
            assert.strict.equal(o.ok, false)
            assert.strict.equal(o.code, 'E_OFFLINE_MISSING', o.message)
            assert.strict.ok(o.message.includes('connMDB.exe') && o.message.includes(sha))
        })

        it(`should write the scratch files to the OS temp folder (a missing temp folder makes the call fail with ENOENT)`, function() {
            let o = runChild(CHILD_JET, {
                W_BIN_CACHE: path.resolve(`${fdJet}/cache`),
                W_BIN_MIRROR: path.resolve(`${fdJet}/mirror`),
                W_BIN_OFFLINE: '1',
                T_MDB: path.resolve(`${fdJet}/x.mdb`),
                TEMP: path.resolve(`${fdJet}/no-such-folder`),
                TMP: path.resolve(`${fdJet}/no-such-folder`),
            }, os.tmpdir())
            assert.strict.equal(o.ok, false)
            assert.strict.equal(o.code, 'ENOENT', JSON.stringify(o))
        })

    })

})
