import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { execSync, execFileSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'


//規格: 外部執行檔之存放下載校驗與離線(制式規格, C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md) S1、S2、S5、M1、M2、M4、§8 T1、T2
//本檔與平台無關(不執行exe), CI(ubuntu)亦跑
//註: 清單讀取放在it內, 缺清單時以個別案例失敗呈現, 不使整個檔載入失敗

let fdt = './test/temp-binmanifest'
let fpManifest = 'bin/manifest.json'
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

let readManifest = () => {
    return JSON.parse(fs.readFileSync(fpManifest, 'utf8'))
}


describe(`bin/manifest.json`, function() {
    this.timeout(120000)

    before(function() {
        fs.rmSync(fdt, { recursive: true, force: true })
    })

    after(function() {
        fs.rmSync(fdt, { recursive: true, force: true })
    })

    it(`should be a pinned manifest of this package with only connMDB.exe (M1, S2, 本套件為D類釘選模式)`, function() {
        let m = readManifest()
        assert.strict.equal(m.schema, 1)
        assert.strict.equal(m.pkg, pkg.name)
        assert.strict.equal(m.mode, 'pinned')
        assert.strict.equal(m.repo, `yuda-lyu/${pkg.name}`)
        assert.strict.ok(/^[0-9a-f]{40}$/.test(m.commit), `commit須為40碼小寫十六進位: ${m.commit}`)
        assert.strict.equal(m.files.length, 1)
        let f = m.files[0]
        assert.strict.equal(f.name, 'connMDB.exe')
        assert.strict.equal(f.path, 'bin/connMDB.exe')
        assert.strict.ok(/^[0-9a-f]{64}$/.test(f.sha256), `sha256須為64碼十六進位: ${f.sha256}`)
        assert.strict.ok(Number.isInteger(f.size) && f.size > 0, `size須為正整數: ${f.size}`)
    })

    it(`should pass the schema check of fsEnsureBins (M1, M2)`, async function() {
        //離線且快取為空資料夾: 清單有效時為E_OFFLINE_MISSING(缺檔), 清單無效時為E_MANIFEST; 不連網
        let err = null
        try {
            await fsEnsureBins(fpManifest, { pkgRoot: '.', cacheDir: `${fdt}/cache`, mirror: '', offline: true })
        }
        catch (e) {
            err = e
        }
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
    })

    it(`should match the real files in bin/ (M4, T2)`, async function() {
        let m = readManifest()
        for (let f of m.files) {
            for (let p of [f, ...(f.parts || [])]) {
                if (typeof p.path === 'string') {
                    let e = await fsGetBinManifestEntry(p.path)
                    assert.strict.deepStrictEqual([e.sha256, e.size], [p.sha256, p.size], p.path)
                }
            }
        }
    })

    it(`should list every file in bin/ in the manifest (M4 反向: bin/內不得有清單未載之檔)`, function() {
        let m = readManifest()
        let inManifest = m.files.map((f) => path.posix.basename(f.path)).sort()
        let inBin = fs.readdirSync('bin').filter((v) => v !== 'manifest.json').sort()
        assert.strict.deepStrictEqual(inBin, inManifest)
    })

    it(`should have the pinned commit contain the same bytes as bin/ (M2: 釘選提交之原始檔=清單所載, GitHub依此提交供檔)`, function() {
        let m = readManifest()
        let git = (args) => {
            return execFileSync('git', args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
        }
        try {
            git(['cat-file', '-e', `${m.commit}^{commit}`])
        }
        catch (err) {
            //淺層clone等取不到該提交時無從比對(本機完整clone必有)
            this.skip()
        }
        for (let f of m.files) {
            let b = git(['show', `${m.commit}:${f.path}`])
            assert.strict.equal(b.length, f.size, `${f.path} size@${m.commit}`)
            let sha = fs.readFileSync(f.path)
            assert.strict.ok(b.equals(sha), `${f.path}@${m.commit} 與工作樹內容不同`)
        }
    })

    it(`should not pack external executables into the npm package, only bin/manifest.json (S1, S5, T1)`, function() {
        let r = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }))
        let info = Array.isArray(r) ? r[0] : Object.values(r)[0] //npm 11以前為陣列, npm 12起為以套件名為鍵之物件
        let fps = info.files.map((v) => v.path)
        //任何位置皆無外部執行檔(含src/connMDB.exe)
        assert.strict.deepStrictEqual(fps.filter((v) => /\.(exe|dll|msi|zip|7z|\d{3})$/i.test(v)), [])
        //bin/與bin-cache/下只有清單
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('bin/') || v.startsWith('bin-cache/')), ['bin/manifest.json'])
        //入包之程式含取得執行檔所需之檔
        assert.strict.ok(fps.includes('src/ensureBins.mjs'), 'src/ensureBins.mjs須入包')
        assert.strict.ok(fps.includes('src/jet.mjs'), 'src/jet.mjs須入包')
    })

})
