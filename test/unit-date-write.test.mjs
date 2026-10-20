/* eslint-disable no-new-wrappers */ //本檔刻意以new String、new Boolean、new Number建構包裝物件, 驗證日期欄對非Date物件值之處置
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import jetOpen from '../src/jet.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import withTz from './tools/withTz.mjs'


//spec: CLAUDE_rulebook.md之R-DATE
//  R-DATE-01 寫入DATE欄之日期須為本地年100–9999(Jet以本地分量存放, 年0–99被靜默改年, 年>=10000報語法錯)
//  R-DATE-02 任一筆任一欄越界或無效 → 整批reject、資料庫不變(insert、insertBulk、save含autoInsert:false與更新路徑)、error事件恰一次、change不發
//  R-DATE-03 訊息 invalid data: date is not a valid time in years 100-9999 at [data[k].欄名], 不回顯值
//  R-DATE-05 字串: 4位數年<100拒收; select回傳形式之無時區字串(O1)正規化後可寫回(往返); 含Z或偏移之ISO字串轉Date; 其餘字串交Jet
//資產: worm_pk_def.mdb之[tt](id TEXT PK, fDate DATETIME, fBool, fDec, fInt, fDbl, fStr TEXT, fText)與test/assets/models/tt.js


let nm = 'date-write'
let fdTmp = `./test/temp-${nm}`
let fdModels = `${fdTmp}/models`
let fpStorage = `${fdTmp}/${nm}.mdb`

const p2 = (n) => String(n).padStart(2, '0')

//mkLocal, 以本地分量建Date(setFullYear避免new Date(y,…)把0–99年映射為1900+)
function mkLocal(y, mo = 6, d = 15, h = 12, mi = 0, s = 0, ms = 0) {
    let t = new Date(2000, 0, 1, 0, 0, 0, 0)
    t.setFullYear(y, mo - 1, d)
    t.setHours(h, mi, s, ms)
    return t
}

//mkUtc, 以UTC分量建Date
function mkUtc(y, mo = 1, d = 1, h = 0, mi = 0, s = 0, ms = 0) {
    let t = new Date(0)
    t.setUTCFullYear(y, mo - 1, d)
    t.setUTCHours(h, mi, s, ms)
    return t
}

const MSG = /^invalid data: date is not a valid time in years 100-9999 at \[data\[(\d+)\]\.(\w+)\]$/
const GOOD = () => mkLocal(2026, 6, 15, 12)
const GOOD_STORED = '2026-06-15T12:00:00'


if (isWindows()) {
    describe('WOrmMdb date-write(R-DATE-01、02、03、05)', function() {

        let jet = null

        function mk(ext = {}) {
            let w = wo({ url: 'mdb://:', db: 'worm', cl: 'tt', fdModels, storage: fpStorage, ...ext })
            let ev = { error: [], change: [] }
            w.on('error', (mode, data, err) => {
                ev.error.push(err)
            })
            w.on('change', (mode, data, res) => {
                ev.change.push({ mode, data, res })
            })
            return { w, ev }
        }

        //reset, 以原生SQL清表並寫入初始列(日期以字串常值), 不經受測函數
        async function reset(rows = []) {
            let cmds = [{ type: 'execute', sql: 'DELETE FROM [tt]' }]
            for (let r of rows) {
                cmds.push({ type: 'execute', sql: `INSERT INTO [tt] ([id], [fDate], [fStr]) VALUES ('${r.id}', ${r.d ? `'${r.d}'` : 'NULL'}, ${r.s ? `'${r.s}'` : 'NULL'})` })
            }
            let res = await jet.run(cmds)
            assert.strict.ok(res.ok, `reset failed: ${res.error}`)
        }

        async function snap() {
            let rs = await jet.query('SELECT [id], [fDate], [fStr] FROM [tt]')
            return JSON.stringify(rs.map((r) => [r.id, r.fDate, r.fStr]).sort())
        }

        async function dateOf(id) {
            let rs = await jet.query(`SELECT [fDate] FROM [tt] WHERE [id] = '${id}'`)
            return rs.length === 0 ? undefined : rs[0].fDate
        }

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdModels, { recursive: true })
            fs.copyFileSync('./test/assets/worm_pk_def.mdb', fpStorage)
            for (let fn of fs.readdirSync('./test/assets/models')) {
                fs.copyFileSync(path.join('./test/assets/models', fn), path.join(fdModels, fn))
            }
            jet = jetOpen({ path: path.resolve(fpStorage), password: '' })
        })

        after(function() {
            cleanStorage(fdTmp)
        })

        //入口 × 值(輸入空間表①): 批次為[好筆, 待測筆](save更新路徑為[待測筆, 好筆], autoInsert:false為單筆)
        const ENTRIES = [
            { nm: 'insert', seed: false, iBad: 1, fn: (w, v) => w.insert([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: v }]) },
            { nm: 'insert{returnList}', seed: false, iBad: 1, fn: (w, v) => w.insert([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: v }], { returnList: true }) },
            { nm: 'insertBulk', seed: false, iBad: 1, fn: (w, v) => w.insertBulk([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: v }]) },
            { nm: 'save(插入路徑)', seed: false, iBad: 1, fn: (w, v) => w.save([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: v }]) },
            { nm: 'save(更新路徑)', seed: true, iBad: 0, fn: (w, v) => w.save([{ id: 'x', fDate: v }, { id: 'good', fDate: GOOD() }]) },
            { nm: 'save(autoInsert:false)', seed: true, iBad: 0, goodAfter: '2020-01-01T00:00:00', fn: (w, v) => w.save([{ id: 'x', fDate: v }], { autoInsert: false }) },
        ]
        const SEED = [{ id: 'x', d: '2020-01-01 00:00:00' }, { id: 'good', d: '2020-01-01 00:00:00' }]

        //壞值: 須整批reject、DB不變
        const BAD = [
            ['Date 本地年0001', () => mkLocal(1, 6, 15, 12)],
            ['Date 本地年0099末', () => mkLocal(99, 12, 31, 23, 59, 59)],
            ['Date 本地年10000初', () => mkLocal(10000, 1, 1, 0, 0, 0)],
            ['Invalid Date', () => new Date(NaN)],
            ['字串 0050-06-15', () => '0050-06-15'],
            ['字串 06/15/0050', () => '06/15/0050'],
            ['字串 0099-12-31T23:59:59(無時區T形式)', () => '0099-12-31T23:59:59'],
            ['字串 2026-02-30T00:00:00(曆法不存在)', () => '2026-02-30T00:00:00'],
            ['字串 0099-06-15T12:00:00Z(ISO含Z)', () => '0099-06-15T12:00:00Z'],
        ]
        //好值: 須成功且存值等於預期
        const OK = [
            ['Date 本地年0100初', () => mkLocal(100, 1, 1, 0, 0, 0), '0100-01-01T00:00:00'],
            ['Date 本地年9999末', () => mkLocal(9999, 12, 31, 23, 59, 59), '9999-12-31T23:59:59'],
            ['字串 2026-06-15 12:00:00(交Jet)', () => '2026-06-15 12:00:00', '2026-06-15T12:00:00'],
            ['字串 6/15/50(兩位數年交Jet)', () => '6/15/50', '1950-06-15T00:00:00'],
            ['字串 2026-06-15T12:00:00(無時區T形式, O1)', () => '2026-06-15T12:00:00', '2026-06-15T12:00:00'],
            ['字串 2026-06-15T12:00:00.500(含小數秒, O1)', () => '2026-06-15T12:00:00.500', '2026-06-15T12:00:00'],
        ]

        for (let en of ENTRIES) {
            describe(`入口 ${en.nm}`, function() {

                for (let [lb, mkv] of BAD) {
                    it(`${lb}: 整批reject、DB不變、error事件一次、change不發、訊息不回顯值(R-DATE-02、03)`, async function() {
                        await reset(en.seed ? SEED : [])
                        let before = await snap()
                        let { w, ev } = mk()
                        let err = null
                        await en.fn(w, mkv()).catch((e) => {
                            err = e
                        })
                        assert.strict.ok(err instanceof Error, '應reject')
                        let m = MSG.exec(err.message)
                        assert.strict.ok(m, `訊息格式: ${err.message}`)
                        assert.strict.strictEqual(Number(m[1]), en.iBad, '位置為待測筆之索引')
                        assert.strict.strictEqual(m[2], 'fDate')
                        assert.strict.ok(!/0050|0099|10000-|2026-02/.test(err.message.replace('100-9999', '')), '不回顯值')
                        assert.strict.strictEqual(await snap(), before, '資料庫不變(含同批好筆)')
                        assert.strict.strictEqual(ev.error.length, 1, 'error事件一次')
                        assert.strict.strictEqual(ev.change.length, 0, 'change不發')
                    })
                }

                for (let [lb, mkv, stored] of OK) {
                    it(`${lb}: 成功且存值為 ${stored}(好筆亦寫入)`, async function() {
                        await reset(en.seed ? SEED : [])
                        let { w, ev } = mk()
                        await en.fn(w, mkv())
                        assert.strict.strictEqual(await dateOf('x'), stored)
                        assert.strict.strictEqual(await dateOf('good'), en.goodAfter || GOOD_STORED)
                        assert.strict.strictEqual(ev.error.length, 0)
                    })
                }

            })
        }

        describe('批次組成與訊息位置(R-DATE-02、03)', function() {

            it('壞筆在前或在中間: 好筆皆不寫入', async function() {
                for (let batch of [
                    [{ id: 'x', fDate: mkLocal(50) }, { id: 'a', fDate: GOOD() }],
                    [{ id: 'a', fDate: GOOD() }, { id: 'x', fDate: mkLocal(50) }, { id: 'b', fDate: GOOD() }],
                ]) {
                    for (let fn of ['insert', 'insertBulk', 'save']) {
                        await reset([])
                        let { w } = mk()
                        await assert.rejects(w[fn](batch), (e) => MSG.test(e.message), fn)
                        assert.strict.strictEqual(await snap(), '[]', `${fn} 資料庫不變`)
                    }
                }
            })

            it('多筆越界回報索引最小者, 同筆多欄回報model定義順序之第一個欄(fDate先於fStr)', async function() {
                let { w } = mk()
                await reset([])
                let err = await w.insert([{ id: 'a', fDate: GOOD() }, { id: 'b', fStr: mkLocal(50), fDate: mkLocal(50) }, { id: 'c', fDate: mkLocal(50) }]).catch((e) => e)
                assert.strict.strictEqual(err.message, 'invalid data: date is not a valid time in years 100-9999 at [data[1].fDate]')
            })

            it('Date寫入非DATE欄(STRING)亦被檢核: Jet會把年50改為1950再轉成文字(R-DATE-01)', async function() {
                let { w, ev } = mk()
                await reset([])
                let err = await w.insert({ id: 'a', fStr: mkLocal(50, 6, 15, 12) }).catch((e) => e)
                assert.strict.strictEqual(err.message, 'invalid data: date is not a valid time in years 100-9999 at [data[0].fStr]')
                assert.strict.strictEqual(await snap(), '[]')
                assert.strict.strictEqual(ev.error.length, 1)
                await w.insert({ id: 'b', fStr: GOOD() })
                let rows = await jet.query('SELECT [fStr] FROM [tt] WHERE [id] = \'b\'')
                assert.strict.strictEqual(rows.length, 1, '2026年之Date寫入STRING欄不受影響')
                assert.strict.match(rows[0].fStr, /2026/, 'Jet轉成之文字(格式隨OS區域)仍為2026年, 未被改年')
            })

            it('save: 不會寫入之列(主鍵超過255字元、autoInsert:false未命中)含越界日期亦整批reject, 不降為該筆ok為0(R-DATE-02)', async function() {
                let { w, ev } = mk()
                let L300 = 'x'.repeat(300)
                //autoInsert預設: 主鍵超過255字元之列不送Jet(該筆ok為0), 但其日期仍須先檢核
                await reset([])
                let err = await w.save([{ id: 'good', fDate: GOOD() }, { id: L300, fDate: mkLocal(50) }]).catch((e) => e)
                assert.strict.match(err.message, MSG)
                assert.strict.strictEqual(err.message.endsWith('[data[1].fDate]'), true)
                assert.strict.strictEqual(await snap(), '[]')
                //autoInsert:false: 未命中之列不會寫入, 其日期亦須先檢核; 已命中之好列不得被更新
                await reset([{ id: 'good', d: '2020-01-01 00:00:00' }])
                let before = await snap()
                err = await w.save([{ id: 'good', fDate: GOOD() }, { id: 'nohit', fDate: mkLocal(10000, 1, 1, 0, 0, 0) }], { autoInsert: false }).catch((e) => e)
                assert.strict.match(err.message, MSG)
                assert.strict.strictEqual(await snap(), before, '已命中之好列亦不更新')
                assert.strict.strictEqual(ev.error.length, 2)
                assert.strict.strictEqual(ev.change.length, 0)
            })

            it('null與未給之日期欄不檢核; 其他字串(2026-06-15、2026/06/15)交Jet原樣', async function() {
                let { w } = mk()
                await reset([])
                await w.insert([{ id: 'n1', fDate: null }, { id: 'n2' }, { id: 's1', fDate: '2026-06-15' }, { id: 's2', fDate: '2026/06/15' }])
                assert.strict.strictEqual(await dateOf('n1'), null)
                assert.strict.strictEqual(await dateOf('n2'), null)
                assert.strict.strictEqual(await dateOf('s1'), '2026-06-15T00:00:00')
                assert.strict.strictEqual(await dateOf('s2'), '2026-06-15T00:00:00')
            })

            it('垃圾字串仍由Jet判定(現況行為不變): insert reject', async function() {
                let { w } = mk()
                await reset([])
                await assert.rejects(w.insert({ id: 'g', fDate: 'garbage' }))
            })

        })

        describe('字串文法與物件值(外審opus F1、F2、F4): 會被Jet靜默改年或錯讀之寫法經公開API皆整批reject', function() {

            //以真Jet實測會被靜默改年(0050→1950、099→1999、001→2001)或當成時間(15.06.0050)之寫法
            const AGED = [
                '0050-06-15 12:00:00', '0050年6月15日', 'June 15, 0050', '15 Jun 0050', '15-Jun-0050', '0050-Jun-15', 'June 0050', '0050 06 15', '12:00 0050-06-15',
                '12:00:00 06/15/0050', '0050-06', '06/0050', '0050/06', '6/0050', '050-06-15', '06/15/050', '099-12-31', '001-06-15', '15.06.0050', '０050-06-15', '００５０-０６-１５',
            ]
            for (let s of AGED) {
                it(`字串 ${JSON.stringify(s)}: insert與save皆整批reject、DB不變`, async function() {
                    for (let fn of ['insert', 'save']) {
                        await reset([])
                        let { w } = mk()
                        let err = await w[fn]([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: s }]).catch((e) => e)
                        assert.strict.ok(err instanceof Error && MSG.test(err.message), `${fn} ${err && err.message}`)
                        assert.strict.strictEqual(await snap(), '[]', `${fn} DB不變`)
                    }
                })
            }

            it('字串包裝物件、陣列、自訂toString之物件(escVal以String(v)當字串寫出)與字串同判定', async function() {
                for (let mkv of [() => new String('0050-06-15'), () => ['0050-06-15'], () => ({ toString: () => '0050-06-15' })]) {
                    for (let fn of ['insert', 'insertBulk', 'save']) {
                        await reset([])
                        let { w } = mk()
                        let err = await w[fn]([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: mkv() }]).catch((e) => e)
                        assert.strict.ok(err instanceof Error && MSG.test(err.message), `${fn} ${String(mkv())} ${err && err.message}`)
                        assert.strict.strictEqual(await snap(), '[]')
                    }
                }
                //O1形式之包裝物件亦正規化而可寫入
                await reset([])
                let { w } = mk()
                await w.insert({ id: 'o', fDate: new String('2026-06-15T12:00:00') })
                assert.strict.strictEqual(await dateOf('o'), '2026-06-15T12:00:00')
            })

            it('空格分隔與純日期之曆法不存在者整批reject, insert不再先寫入好筆(原為Jet 3464且好筆已寫入)', async function() {
                for (let s of ['2026-02-30 00:00:00', '2026-06-31 12:00:00', '2026-02-30', '2026-06-31', '2026-13-01']) {
                    await reset([])
                    let { w } = mk()
                    let err = await w.insert([{ id: 'good', fDate: GOOD() }, { id: 'x', fDate: s }]).catch((e) => e)
                    assert.strict.ok(err instanceof Error && MSG.test(err.message), `${s} ${err && err.message}`)
                    assert.strict.strictEqual(await snap(), '[]', s)
                }
                await reset([])
                let { w } = mk()
                await w.insert([{ id: 'a', fDate: '2026-02-28 23:59:59' }, { id: 'b', fDate: '2024-02-29' }, { id: 'c', fDate: '2026-06-15 12:00:00.987' }])
                assert.strict.strictEqual(await dateOf('a'), '2026-02-28T23:59:59')
                assert.strict.strictEqual(await dateOf('b'), '2024-02-29T00:00:00')
                assert.strict.strictEqual(await dateOf('c'), '2026-06-15T12:00:00', '空格分隔含小數秒: 小數秒捨去')
            })

            it('含Z或偏移之ISO字串依本地年判定: Taipei寫0099-12-31T20:00:00Z成功(本地年100)、LA寫0100-01-01T05:00:00Z reject(本地年99)', async function() {
                await withTz('Asia/Taipei', async() => {
                    await reset([])
                    let { w } = mk()
                    await w.insert({ id: 'a', fDate: '0099-12-31T20:00:00Z' })
                    assert.strict.match(await dateOf('a'), /^0100-01-01T0[34]:\d\d:\d\d$/, '本地時間0100-01-01凌晨(偏移+8:00或早年LMT+8:06)')
                    let err = await w.insert({ id: 'b', fDate: '9999-12-31T20:00:00Z' }).catch((e) => e)
                    assert.strict.match(err.message, MSG, '本地時間已是10000年')
                })
                await withTz('America/Los_Angeles', async() => {
                    await reset([])
                    let { w } = mk()
                    let err = await w.insert({ id: 'a', fDate: '0100-01-01T05:00:00Z' }).catch((e) => e)
                    assert.strict.match(err.message, MSG, '本地時間0099-12-31晚間')
                    await w.insert({ id: 'b', fDate: '9999-12-31T20:00:00Z' })
                    assert.strict.strictEqual(await dateOf('b'), '9999-12-31T12:00:00')
                })
            })

        })

        describe('DATEONLY欄(model型別為DATEONLY, Jet欄仍為DATETIME)與DATE欄同處置(R-DATE-05)', function() {

            let fdDo = `${fdTmp}/models-dateonly`

            before(function() {
                fs.mkdirSync(fdDo, { recursive: true })
                let s = fs.readFileSync('./test/assets/models/tt.js', 'utf8')
                assert.strict.ok(s.includes('type: DataTypes.DATE,'), 'tt.js之fDate為DATE')
                fs.writeFileSync(path.join(fdDo, 'tt.js'), s.replace('type: DataTypes.DATE,', 'type: DataTypes.DATEONLY,'), 'utf8')
            })

            it('4位數年<100之字串與Date皆整批reject, 無時區T形式字串正規化, 日期字串交Jet', async function() {
                await reset([])
                let { w } = mk({ fdModels: fdDo })
                for (let v of ['0050-06-15', '0099-12-31T23:59:59', '2026-02-30T00:00:00', mkLocal(50)]) {
                    let err = await w.insert({ id: 'x', fDate: v }).catch((e) => e)
                    assert.strict.match(err.message, MSG, String(v))
                    assert.strict.strictEqual(await snap(), '[]')
                }
                await w.insert([{ id: 'a', fDate: '2026-06-15' }, { id: 'b', fDate: '2026-06-15T12:00:00' }])
                assert.strict.strictEqual(await dateOf('a'), '2026-06-15T00:00:00')
                assert.strict.strictEqual(await dateOf('b'), '2026-06-15T12:00:00')
            })

        })

        describe('時區(R-DATE-01: 本地年, 非UTC年)', function() {

            //以真Jet為準之邊界: 本地分量建構者各時區皆同; UTC分量建構者隨偏移正負而異(僅列偏移正負號明確之時區;
            //未列者如Kiritimati之早年LMT倚賴時區資料庫版本, 改以執行時之本地年判定期望值, 與真Jet之吻合由unit-date-range之對照組驗證)
            const CELLS = [
                ['L 0099-12-31T23:59:59', () => mkLocal(99, 12, 31, 23, 59, 59), { 'Asia/Taipei': false, 'America/Los_Angeles': false, 'Pacific/Kiritimati': false, 'UTC': false }],
                ['L 0100-01-01T00:00:00', () => mkLocal(100, 1, 1, 0, 0, 0), { 'Asia/Taipei': true, 'America/Los_Angeles': true, 'Pacific/Kiritimati': true, 'UTC': true }],
                ['L 9999-12-31T23:59:59', () => mkLocal(9999, 12, 31, 23, 59, 59), { 'Asia/Taipei': true, 'America/Los_Angeles': true, 'Pacific/Kiritimati': true, 'UTC': true }],
                ['L 10000-01-01T00:00:00', () => mkLocal(10000, 1, 1, 0, 0, 0), { 'Asia/Taipei': false, 'America/Los_Angeles': false, 'Pacific/Kiritimati': false, 'UTC': false }],
                //UTC 0100-01-01T00:00:00Z: 正偏移時區本地年為100(可寫), 負偏移與UTC+14之LMT前之本地年為99(Jet會改年)
                ['U 0100-01-01T00:00:00Z', () => mkUtc(100, 1, 1), { 'Asia/Taipei': true, 'America/Los_Angeles': false, 'UTC': true }],
                //UTC 9999-12-31T23:59:59.999Z: 正偏移時區本地年為10000(Jet報錯), 負偏移為9999(可寫)
                ['U 9999-12-31T23:59:59.999Z', () => mkUtc(9999, 12, 31, 23, 59, 59, 999), { 'Asia/Taipei': false, 'America/Los_Angeles': true, 'UTC': true }],
            ]

            for (let tz of ['Asia/Taipei', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
                it(`${tz}: 邊界瞬間逐一insert, 接受者存值等於本地分量、拒收者DB不變`, async function() {
                    await withTz(tz, async() => {
                        for (let [lb, mkv, exp] of CELLS) {
                            await reset([])
                            let { w } = mk()
                            let d = mkv()
                            let err = await w.insert({ id: 'c', fDate: d }).catch((e) => e)
                            let ok = exp[tz] === undefined ? (d.getFullYear() >= 100 && d.getFullYear() <= 9999) : exp[tz]
                            if (ok) {
                                assert.strict.ok(!(err instanceof Error), `${tz} ${lb} 應成功: ${err && err.message}`)
                                let want = `${String(d.getFullYear()).padStart(4, '0')}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
                                assert.strict.strictEqual(await dateOf('c'), want, `${tz} ${lb}`)
                            }
                            else {
                                assert.strict.ok(err instanceof Error, `${tz} ${lb} 應reject`)
                                assert.strict.match(err.message, MSG, `${tz} ${lb}`)
                                assert.strict.strictEqual(await snap(), '[]', `${tz} ${lb} DB不變`)
                            }
                        }
                    })
                })
            }

        })

        describe('含Z或偏移之ISO字串(R-DATE-05): 轉Date後依本地分量寫入', function() {

            const ISO = [
                ['2026-06-15T12:00:00+08:00', { 'Asia/Taipei': '2026-06-15T12:00:00', 'America/Los_Angeles': '2026-06-14T21:00:00', 'Pacific/Kiritimati': '2026-06-15T18:00:00', 'UTC': '2026-06-15T04:00:00' }],
                ['2026-06-15T12:00:00.123Z', { 'Asia/Taipei': '2026-06-15T20:00:00', 'America/Los_Angeles': '2026-06-15T05:00:00', 'Pacific/Kiritimati': '2026-06-16T02:00:00', 'UTC': '2026-06-15T12:00:00' }],
                ['2026-06-15 12:00:00Z', { 'Asia/Taipei': '2026-06-15T20:00:00', 'America/Los_Angeles': '2026-06-15T05:00:00', 'Pacific/Kiritimati': '2026-06-16T02:00:00', 'UTC': '2026-06-15T12:00:00' }],
            ]
            for (let tz of ['Asia/Taipei', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
                it(`${tz}: ISO字串寫入後存值為該瞬間之本地分量`, async function() {
                    await withTz(tz, async() => {
                        for (let [s, exp] of ISO) {
                            await reset([])
                            let { w } = mk()
                            await w.insert({ id: 'c', fDate: s })
                            assert.strict.strictEqual(await dateOf('c'), exp[tz], `${tz} ${s}`)
                        }
                    })
                })
            }

            it('ISO字串之本地年<100者拒收(任何時區): 0099-06-15T12:00:00Z', async function() {
                for (let tz of ['Asia/Taipei', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
                    await withTz(tz, async() => {
                        await reset([])
                        let { w } = mk()
                        let err = await w.insert({ id: 'c', fDate: '0099-06-15T12:00:00Z' }).catch((e) => e)
                        assert.strict.match(err.message, MSG, tz)
                    })
                }
            })

        })

        describe('往返: select取出之列原樣save/insert(O1)', function() {

            for (let tz of ['Asia/Taipei', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
                it(`${tz}: select取出列 → 改其他欄 → save成功且日期值不變`, async function() {
                    await withTz(tz, async() => {
                        await reset([{ id: 'r1', d: '2026-06-15 12:00:00', s: 'old' }, { id: 'r2', d: '9999-12-31 23:59:59', s: 'old' }, { id: 'r3', d: '0100-01-01 00:00:00', s: 'old' }, { id: 'r4', d: null, s: 'old' }])
                        let { w } = mk()
                        let rows = await w.select({})
                        assert.strict.strictEqual(rows.length, 4)
                        assert.strict.strictEqual(rows.find((r) => r.id === 'r1').fDate, '2026-06-15T12:00:00', 'select回傳形式')
                        assert.strict.strictEqual(rows.find((r) => r.id === 'r3').fDate, '0100-01-01T00:00:00', 'Jet如實存放年100(不被兩位數年規則改年), 往返前後值才有鑑別力')
                        assert.strict.strictEqual(rows.find((r) => r.id === 'r2').fDate, '9999-12-31T23:59:59')
                        let before = JSON.parse(await snap()).map((x) => [x[0], x[1]])
                        let res = await w.save(rows.map((r) => ({ ...r, fStr: 'new' })))
                        assert.strict.deepStrictEqual(res.map((x) => x.ok), [1, 1, 1, 1], '修前: ok:0(Jet 3464)')
                        let after = JSON.parse(await snap())
                        assert.strict.deepStrictEqual(after.map((x) => [x[0], x[1]]), before, '日期值不變')
                        assert.strict.ok(after.every((x) => x[2] === 'new'), '其他欄已改')
                    })
                })
            }

            it('夏令跳過之時刻(美西2026-03-08T02:30:00)往返後Jet存值與原值逐字相同(不經Date)', async function() {
                await withTz('America/Los_Angeles', async() => {
                    await reset([{ id: 'g', d: '2026-03-08 02:30:00', s: 'old' }])
                    assert.strict.strictEqual(await dateOf('g'), '2026-03-08T02:30:00')
                    let { w } = mk()
                    let [row] = await w.select({ id: 'g' })
                    let res = await w.save({ ...row, fStr: 'new' })
                    assert.strict.strictEqual(res[0].ok, 1)
                    assert.strict.strictEqual(await dateOf('g'), '2026-03-08T02:30:00')
                })
            })

            it('select取出之列以新主鍵insert、insertBulk皆成功且日期相同', async function() {
                await reset([{ id: 'r1', d: '2026-06-15 12:00:00', s: 'old' }])
                let { w } = mk()
                let [row] = await w.select({ id: 'r1' })
                await w.insert({ ...row, id: 'n1' })
                await w.insertBulk({ ...row, id: 'n2' })
                assert.strict.strictEqual(await dateOf('n1'), '2026-06-15T12:00:00')
                assert.strict.strictEqual(await dateOf('n2'), '2026-06-15T12:00:00')
            })

            it('change事件之data帶正規化值: T形式字串→牆上時間字串, ISO含偏移→Date, Date→一般Date', async function() {
                await reset([])
                let { w, ev } = mk()
                await w.insert([{ id: 'a', fDate: '2026-06-15T12:00:00' }, { id: 'b', fDate: '2026-06-15T12:00:00Z' }, { id: 'c', fDate: GOOD() }])
                let data = ev.change[0].data
                assert.strict.strictEqual(data[0].fDate, '2026-06-15 12:00:00')
                assert.strict.strictEqual(Object.getPrototypeOf(data[1].fDate), Date.prototype)
                assert.strict.strictEqual(data[1].fDate.toISOString(), '2026-06-15T12:00:00.000Z')
                assert.strict.strictEqual(Object.getPrototypeOf(data[2].fDate), Date.prototype)
            })

        })

        describe('呼叫端數據不被改寫(操作對象為cloneDeep複本)', function() {

            it('傳入之物件在成功與reject後皆維持原值', async function() {
                await reset([])
                let { w } = mk()
                let row = { id: 'a', fDate: '2026-06-15T12:00:00' }
                await w.insert(row)
                assert.strict.deepStrictEqual(row, { id: 'a', fDate: '2026-06-15T12:00:00' })
                let bad = { id: 'b', fDate: mkLocal(50) }
                await w.insert(bad).catch(() => {})
                assert.strict.strictEqual(bad.fDate.getFullYear(), 50)
            })

        })

    })
}
