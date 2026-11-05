import assert from 'assert'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import { isWindows } from './unit-setup.mjs'
import jetOpenReal from '../src/jet.mjs'


//spec: sgud/rule/rulebook_data.md 之 R-OPEN(連線開啟失敗之有限重試; LD4 已解)
//  R-OPEN-01 開啟失敗(openFailed為true, 即零語句已執行)且錯誤碼屬 3734、3050(鎖競爭)、3045、3031、3049、3356(併發開啟時之暫態: 資料庫實際可開, 與有無密碼、有無獨占設定無關)者, 整批重試, 至多 8 次嘗試
//  R-OPEN-02 重試次數用盡仍回報原錯誤(結果物件ok為false、openFailed為true、results[0].errorCode與error為最後一次之值); 經query/execute者reject為錯誤訊息字串(形狀同重試前)
//  R-OPEN-03 永久性開啟失敗(檔案不存在3024、格式不符3343、無錯誤碼)不重試, 只嘗試 1 次
//  R-OPEN-04 非開啟失敗(openFailed為false, 即已有語句執行)一律不重試, 即使錯誤碼為上列可重試者; 每次嘗試送出之指令與交易旗標相同
//  R-OPEN-05 (真實 Jet) 錯誤密碼 3031 用盡重試後仍回報(約2~3秒); 開啟失敗時 exe 一律中止其後指令(令 openFailed 恆代表零語句已執行, 為 R-OPEN-01 重試安全之前提)
//
//做法: 以假執行檔(test/tools/fakeConnMDB.cs, 依腳本檔逐次回傳預寫之結果檔內容並記錄次數與每次收到之輸入)取代connMDB.exe,
//      於 test/temp-jet-retry/ 下建一份套件根(src/jet.mjs、src/ensureBins.mjs 為 src/ 之逐位元組複本, 清單與快取指向假執行檔),
//      令受測之 jet.mjs 走完整之 ensureBins → execProcess → 結果檔讀取路徑, 不改任何受測原始碼, 不需真實之 Jet 競爭即可確定性地重現各結果序列
//註: 機率性之併發失敗無法穩定重現, 故以序列注入(R-OPEN-01~04); R-OPEN-05 則直接用真實 src/jet.mjs 與真實執行檔;
//    真實 Jet 之併發另見 unit-concurrency、unit-instance-lifecycle,經公開 API 之密碼錯誤另見 unit-encryption


//嘗試上限, 與 src/jet.mjs 之 nTryOpen 一致(規則帳本 R-OPEN-01)
const N_TRY = 8

//可重試之錯誤碼: 3734、3050 為既有(鎖競爭; 對照組), 3045、3031、3049、3356 為本批新增(LD4, 併發開啟時之暫態)
const RETRY_CODES = [3734, 3050, 3045, 3031, 3049, 3356]

//Jet錯誤訊息(英文系統; 重試判定只看錯誤碼, 不看訊息)
const MSG = {
    3356: 'You attempted to open a database that is already opened exclusively by user \'Admin\' on machine \'HOST\'.  Try again when the database is available.',
    3045: 'Could not use \'\'; file already in use.',
    3031: 'Not a valid password.',
    3049: 'Cannot open database \'\'.  It may not be a database that your application recognizes, or the file may be corrupt.',
    3734: 'The database has been placed in a state by user \'\' on machine \'\' that prevents it from being opened or locked.',
    3050: 'Could not lock file.',
    3024: 'Could not find file \'C:\\no\\such.mdb\'.',
    3343: 'Unrecognized database format \'C:\\no\\such.mdb\'.',
}

//openFail, 開啟失敗之結果檔(exe於開啟失敗時中止其後cmds, results只有第1筆)
function openFail(code, msg) {
    let m = msg === undefined ? MSG[code] : msg
    let rr = { ok: false, error: m }
    if (code !== null) {
        rr.errorCode = code
    }
    return { ok: false, stopped: true, rolledBack: false, openFailed: true, error: m, results: [rr] }
}

//success
function success(n = 1) {
    return { ok: true, stopped: false, rolledBack: false, openFailed: false, error: null, results: [{ ok: true, n }] }
}


if (isWindows()) {
    describe('jet.mjs 連線開啟失敗之有限重試(R-OPEN)', function() {

        this.timeout(120000)

        let fd = path.resolve('./test/temp-jet-retry')
        let fdScripts = path.join(fd, 'scripts')
        let jet = null
        let seq = 0

        before(async function() {

            //先清殘留再建
            fs.rmSync(fd, { recursive: true, force: true })
            fs.mkdirSync(path.join(fd, 'root/src'), { recursive: true })
            fs.mkdirSync(path.join(fd, 'root/bin'), { recursive: true })
            fs.mkdirSync(fdScripts, { recursive: true })

            //編譯假執行檔(Windows內建csc, 與connMDB.exe之建置方式相同)
            let csc = path.join(process.env.windir || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
            let fpExe = path.join(fd, 'root/bin/connMDB.exe')
            let rc = spawnSync(csc, ['-nologo', '-optimize+', `-out:${fpExe}`, path.resolve('./test/tools/fakeConnMDB.cs')], { encoding: 'utf8', windowsHide: true })
            assert.strict.strictEqual(rc.status, 0, `csc編譯假執行檔失敗: ${rc.stdout}${rc.stderr}`)

            //清單與快取(離線; W_BIN_OFFLINE由unit-setup載入之binEnv設定)
            let buf = fs.readFileSync(fpExe)
            let sha = crypto.createHash('sha256').update(buf).digest('hex')
            fs.writeFileSync(path.join(fd, 'root/bin/manifest.json'), JSON.stringify({
                schema: 1,
                pkg: 'w-orm-mdb',
                mode: 'pinned',
                repo: 'yuda-lyu/w-orm-mdb',
                commit: 'a'.repeat(40),
                files: [{ name: 'connMDB.exe', path: 'bin/connMDB.exe', sha256: sha, size: buf.length }],
            }), 'utf8')
            let fdCache = path.join(fd, 'root/bin-cache', sha)
            fs.mkdirSync(fdCache, { recursive: true })
            fs.copyFileSync(fpExe, path.join(fdCache, 'connMDB.exe'))

            //受測原始碼之逐位元組複本
            fs.copyFileSync(path.resolve('./src/jet.mjs'), path.join(fd, 'root/src/jet.mjs'))
            fs.copyFileSync(path.resolve('./src/ensureBins.mjs'), path.join(fd, 'root/src/ensureBins.mjs'))
            let { default: jetOpen } = await import(pathToFileURL(path.join(fd, 'root/src/jet.mjs')).href)
            jet = jetOpen({ path: path.join(fd, 'no-such.mdb'), password: '' })
        })

        after(function() {
            delete process.env.FAKE_MDB_SCRIPT
            try {
                fs.rmSync(fd, { recursive: true, force: true })
            }
            catch (err) {}
        })

        //play, 依序回放lines(第k次呼叫exe得第k行), 回傳{res,err,n(exe被呼叫次數),inputs(每次收到之輸入)}
        async function play(lines, cmds, opt) {
            let fp = path.join(fdScripts, `s${++seq}.txt`)
            fs.writeFileSync(fp, lines.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8')
            process.env.FAKE_MDB_SCRIPT = fp
            let res = null
            let err = null
            try {
                res = await jet.run(cmds, opt)
            }
            catch (e) {
                err = e
            }
            delete process.env.FAKE_MDB_SCRIPT
            let n = Number(fs.readFileSync(`${fp}.n`, 'utf8'))
            let inputs = fs.readFileSync(`${fp}.log`, 'utf8').split('\n').filter((s) => s !== '').map((s) => JSON.parse(s))
            let times = fs.readFileSync(`${fp}.t`, 'utf8').split('\n').filter((s) => s !== '').map((s) => s.split(' ').map(Number))
            return { res, err, n, inputs, times }
        }

        const CMDS = [
            { type: 'execute', sql: 'INSERT INTO t (id) VALUES (\'a\')', stopOnError: false },
            { type: 'execute', sql: 'INSERT INTO t (id) VALUES (\'b\')', stopOnError: false },
        ]

        describe('R-OPEN-01 可重試之開啟失敗: 重試至成功', function() {

            //codes: 3734、3050為既有(對照組); 3031、3049為本批新增(LD4)
            for (let code of RETRY_CODES) {
                it(`${code}: 第1次開啟失敗、第2次成功 → 整批ok, exe共被呼叫2次`, async function() {
                    let { res, err, n } = await play([openFail(code), success(2)], CMDS)
                    assert.strict.strictEqual(err, null, '不得reject')
                    assert.strict.strictEqual(res.ok, true, '最終結果為成功')
                    assert.strict.strictEqual(res.openFailed, false)
                    assert.strict.strictEqual(res.results[0].n, 2, '回傳的是成功那一次之結果')
                    assert.strict.strictEqual(n, 2, `code ${code} 應重試1次`)
                })
            }

            it('混合序列 3031 → 3049 → 3734 → 3050 → 3045 → 3356 → 成功: 共7次嘗試', async function() {
                let { res, err, n } = await play([openFail(3031), openFail(3049), openFail(3734), openFail(3050), openFail(3045), openFail(3356), success()], CMDS)
                assert.strict.strictEqual(err, null)
                assert.strict.strictEqual(res.ok, true)
                assert.strict.strictEqual(n, 7)
            })

            it('第N_TRY次(最後一次機會)才成功: 仍回成功', async function() {
                let lines = []
                for (let i = 0; i < N_TRY - 1; i++) {
                    lines.push(openFail(3031))
                }
                lines.push(success())
                let { res, n } = await play(lines, CMDS)
                assert.strict.strictEqual(res.ok, true)
                assert.strict.strictEqual(n, N_TRY)
            })

        })

        describe('R-OPEN-02 次數用盡仍回報', function() {

            for (let code of RETRY_CODES) {
                it(`${code}: 每次皆失敗 → 嘗試恰${N_TRY}次後回報原錯誤(openFailed為true, 錯誤碼與訊息保留)`, async function() {
                    let { res, err, n } = await play([openFail(code)], CMDS)
                    assert.strict.strictEqual(err, null, 'run不reject, 以結果物件回報整批性錯誤')
                    assert.strict.strictEqual(n, N_TRY, '嘗試次數')
                    assert.strict.strictEqual(res.ok, false)
                    assert.strict.strictEqual(res.openFailed, true, '耗盡後仍帶openFailed, 供呼叫端辨識為整批性錯誤')
                    assert.strict.strictEqual(res.results[0].errorCode, code)
                    assert.strict.strictEqual(res.error, MSG[code])
                })
            }

            it('次數用盡: 相鄰兩次嘗試之間有線性退避(第k次失敗後等25ms×k, 共7次), 且總時間有上限不致無止境', async function() {
                //以假執行檔記錄之各次起訖時間核對: 下一次之起點 − 本次之終點 ≥ 退避(計時器不會提早到期, 只放寬系統時鐘解析度20ms);
                //只斷言下界(負載只會使間隔變大, 不會令此案假失敗); 上限只防無止境
                let t0 = Date.now()
                let { n, times } = await play([openFail(3031)], CMDS)
                let ms = Date.now() - t0
                assert.strict.strictEqual(n, N_TRY)
                assert.strict.strictEqual(times.length, N_TRY)
                for (let k = 1; k < N_TRY; k++) {
                    let gap = times[k][0] - times[k - 1][1]
                    assert.strict.ok(gap >= 25 * k - 20, `第${k}次失敗後之退避應≥${25 * k}ms, 實得間隔${gap}ms`)
                }
                assert.strict.ok(ms < 30000, `用盡所需時間應有上限, 實得${ms}ms`)
            })

            it('經 execute/query 者 reject 為錯誤訊息字串(形狀同重試前, 不是Error物件)', async function() {
                for (let call of [(j) => j.execute('DELETE FROM t'), (j) => j.query('SELECT 1')]) {
                    let fp = path.join(fdScripts, `s${++seq}.txt`)
                    fs.writeFileSync(fp, JSON.stringify(openFail(3031)) + '\n', 'utf8')
                    process.env.FAKE_MDB_SCRIPT = fp
                    let err = null
                    await call(jet).catch((e) => {
                        err = e
                    })
                    delete process.env.FAKE_MDB_SCRIPT
                    assert.strict.strictEqual(typeof err, 'string')
                    assert.strict.strictEqual(err, MSG[3031])
                    assert.strict.strictEqual(Number(fs.readFileSync(`${fp}.n`, 'utf8')), N_TRY)
                }
            })

        })

        describe('R-OPEN-03 永久性開啟失敗不重試', function() {

            let cases = [
                ['檔案不存在 3024', 3024, MSG[3024]],
                ['格式不符 3343', 3343, MSG[3343]],
                ['無錯誤碼(非OleDb例外, 如provider未註冊)', null, 'The \'Microsoft.Jet.OLEDB.4.0\' provider is not registered on the local machine.'],
            ]
            for (let [nm, code, msg] of cases) {
                it(`${nm}: 只嘗試1次即回報`, async function() {
                    let { res, err, n } = await play([openFail(code, msg)], CMDS)
                    assert.strict.strictEqual(err, null)
                    assert.strict.strictEqual(n, 1)
                    assert.strict.strictEqual(res.ok, false)
                    assert.strict.strictEqual(res.openFailed, true)
                    assert.strict.strictEqual(res.error, msg)
                })
            }

        })

        describe('R-OPEN-04 非開啟失敗不重試(語句已執行者重試會重複套用寫入)', function() {

            it('前一筆已成功、後一筆失敗且錯誤碼為3031(openFailed為false) → 只嘗試1次, 結果原樣', async function() {
                let r = {
                    ok: false,
                    stopped: true,
                    rolledBack: false,
                    openFailed: false,
                    error: MSG[3031],
                    results: [{ ok: true, n: 1 }, { ok: false, errorCode: 3031, error: MSG[3031] }],
                }
                let { res, n } = await play([r, success()], CMDS)
                assert.strict.strictEqual(n, 1, '已有語句執行, 不得重試')
                assert.strict.strictEqual(res.ok, false)
                assert.strict.strictEqual(res.results[0].ok, true)
                assert.strict.strictEqual(res.results[1].errorCode, 3031)
            })

            for (let code of RETRY_CODES) {
                it(`首筆執行期失敗且錯誤碼為${code}但openFailed為false → 只嘗試1次`, async function() {
                    let r = {
                        ok: false,
                        stopped: false,
                        rolledBack: false,
                        openFailed: false,
                        error: MSG[code],
                        results: [{ ok: false, errorCode: code, error: MSG[code] }, { ok: true, n: 1 }],
                    }
                    let { res, n } = await play([r, success()], CMDS)
                    assert.strict.strictEqual(n, 1)
                    assert.strict.strictEqual(res.ok, false)
                    assert.strict.strictEqual(res.openFailed, false)
                })
            }

            it('第1次即成功 → 只嘗試1次', async function() {
                let { res, n } = await play([success(), openFail(3031)], CMDS)
                assert.strict.strictEqual(n, 1)
                assert.strict.strictEqual(res.ok, true)
            })

        })

        describe('R-OPEN-05 真實 Jet 與真實執行檔(不經假執行檔): 永久性開啟失敗仍回報, 開啟失敗中止其後指令', function() {

            it('錯誤密碼開啟加密檔: 重試用盡後仍回報 ok:false、openFailed:true、errorCode 3031、原訊息; 所需時間有上限(實測約3.4秒)', async function() {
                let fp = path.join(fd, 'enc-wrong.mdb')
                fs.copyFileSync(path.resolve('./test/assets/worm_encryption_def.mdb'), fp)
                let j = jetOpenReal({ path: fp, password: 'username:wrongpwd' })
                let t0 = Date.now()
                let res = await j.run([{ type: 'query', sql: 'SELECT * FROM users' }])
                let ms = Date.now() - t0
                assert.strict.strictEqual(res.ok, false)
                assert.strict.strictEqual(res.openFailed, true)
                assert.strict.strictEqual(res.results[0].errorCode, 3031)
                assert.strict.ok(String(res.error).indexOf('Not a valid password') >= 0, `實得: ${res.error}`)
                assert.strict.ok(ms < 60000, `永久性失敗之回報時間應有上限(8次嘗試+退避約3.4秒), 實得${ms}ms`)
            })

            it('正確密碼開啟加密檔: 一次成功(對照組, 與錯誤密碼同檔)', async function() {
                let fp = path.join(fd, 'enc-right.mdb')
                fs.copyFileSync(path.resolve('./test/assets/worm_encryption_def.mdb'), fp)
                let j = jetOpenReal({ path: fp, password: 'username:password' })
                let res = await j.run([{ type: 'query', sql: 'SELECT * FROM users' }])
                assert.strict.strictEqual(res.ok, true)
                assert.strict.strictEqual(res.openFailed, false)
            })

            it('檔案不存在(3024)、同批 [execute(stopOnError:false), execute]: 開啟失敗一律中止其後指令(results只有第1筆, stopped), openFailed為true', async function() {
                let j = jetOpenReal({ path: path.join(fd, 'no-such-file.mdb'), password: '' })
                let res = await j.run([
                    { type: 'execute', sql: 'INSERT INTO users (id) VALUES (\'a\')', stopOnError: false },
                    { type: 'execute', sql: 'INSERT INTO users (id) VALUES (\'b\')', stopOnError: false },
                ])
                assert.strict.strictEqual(res.ok, false)
                assert.strict.strictEqual(res.openFailed, true)
                assert.strict.strictEqual(res.stopped, true)
                assert.strict.strictEqual(res.results.length, 1, '開啟失敗後其後指令不得續跑(否則重試會重複套用已成功之語句)')
                assert.strict.strictEqual(res.results[0].errorCode, 3024)
            })

        })

        describe('R-OPEN-04 每次嘗試送出之內容相同', function() {

            it('execute 指令: 3次嘗試之輸入(db、useTransaction、cmds)逐字相同', async function() {
                let { res, n, inputs } = await play([openFail(3031), openFail(3049), success(2)], CMDS)
                assert.strict.strictEqual(res.ok, true)
                assert.strict.strictEqual(n, 3)
                assert.strict.strictEqual(inputs.length, 3)
                assert.strict.deepStrictEqual(inputs[1], inputs[0])
                assert.strict.deepStrictEqual(inputs[2], inputs[0])
                assert.strict.strictEqual(inputs[0].cmds.length, 2)
                assert.strict.strictEqual(inputs[0].cmds[0].sql, CMDS[0].sql)
            })

            it('useTransaction 旗標: 每次嘗試皆帶true', async function() {
                let { n, inputs } = await play([openFail(3031), success(2)], CMDS, { useTransaction: true })
                assert.strict.strictEqual(n, 2)
                assert.strict.deepStrictEqual(inputs.map((v) => v.useTransaction), [true, true])
            })

            it('query 指令: 每次嘗試之輸出檔路徑各自獨立(含不同id), 其餘相同', async function() {
                let cmds = [{ type: 'query', sql: 'SELECT * FROM t' }]
                let { n, inputs } = await play([openFail(3049), success()], cmds)
                assert.strict.strictEqual(n, 2)
                assert.strict.notStrictEqual(inputs[0].cmds[0].fpOut, inputs[1].cmds[0].fpOut)
                let norm = (v) => {
                    return { ...v, cmds: v.cmds.map((c) => ({ ...c, fpOut: '' })) }
                }
                assert.strict.deepStrictEqual(norm(inputs[1]), norm(inputs[0]))
            })

        })

    })
}
