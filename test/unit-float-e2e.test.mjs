import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import jetOpen from '../src/jet.mjs'
import { isWindows } from './unit-setup.mjs'
import withTz from './tools/withTz.mjs'
import { TZS_NEG, tzProof, wallNum, condVal, condWall, cmpOk } from './tools/floatTools.mjs'


//spec: CLAUDE_rulebook.md之R-FLOAT-00(日期條件與Jet列之DATE值處於同一浮動空間, 命中 = 牆上時間數值比較; 無時區字串條件與主機時區無關, 固定瞬間之Date/epoch取主機本地分量)與R-FLOAT-03 1.(哨兵不被誤刪)、〈條件(find)之支援範圍〉之系列最低要求①(select命中集合 = delAll實刪集合)
//本檔: 真Jet端到端(公開API select/delAll): 負偏移時區下 delAll({dt:{$lt:今日}}) 不得刪除9999-12-31 23:59:59之哨兵列(資料遺失類); 時區矩陣之全格見unit-float-tz.test.mjs(queryMemory層)
//註: 時區以withTz於程序內切換(Windows命令列TZ=僅UTC與POSIX名有效); 每個時區先tzProof自證偏移生效


let nm = 'float-e2e'
let fdTmp = `./test/temp-${nm}`
let fdModels = `${fdTmp}/models`
let fpSeed = `${fdTmp}/seed.mdb`

//Jet內之牆上時間(含哨兵、年100、美東/柏林夏令跳過與美東重疊、NULL)
const SEEDS = [
    ['expired', '2020-01-01 00:00:00'],
    ['never', '9999-12-31 23:59:59'],
    ['future', '2099-01-01 00:00:00'],
    ['min', '0100-01-01 00:00:00'],
    ['nyskip', '2026-03-08 02:30:00'],
    ['berskip', '2026-03-29 02:30:00'],
    ['nyovl', '2026-11-01 01:30:00'],
    ['nul', null],
]

//條件(牆上時間 + 形式); 預言機由wallNum數值比較得出
const CONDS = [
    ['2026-10-20 00:00:00', 'str'],
    ['9999-12-31 23:59:59', 'str'],
    ['9999-12-31 23:59:59', 'date'],
    ['9999-12-31 23:59:59', 'epoch'],
    ['2026-03-08 02:30:00', 'str'],
    ['2026-03-29 02:30:00', 'str'],
    ['2026-11-01 01:30:00', 'str'],
    ['0100-01-01 00:00:00', 'str'],
    ['2026-10-20 00:00:00', 'date'],
]
const OPS = ['$lt', '$gte', '$eq', '$ne']

//e2e之時區: 4個負偏移 + 柏林(正偏移有夏令) + 台北(正偏移無夏令)
const TZS_E2E = [...TZS_NEG, 'Europe/Berlin', 'Asia/Taipei']


function mkW(fp) {
    let w = wo({ url: 'mdb://:', db: 'worm', cl: 'tc', pk: 'id', fdModels, storage: fp })
    let evs = []
    w.on('error', (e) => {
        evs.push(e)
    })
    return { w, evs }
}

async function readIds(fp, tb = 'tc') {
    let jet = jetOpen({ path: path.resolve(fp), password: '' })
    let rows = await jet.query(`SELECT [id] FROM [${tb}]`)
    return rows.map((v) => v.id).sort()
}

//rejMsg, 斷言promise確實reject(獨立旗標, 不以初始值推導)並回傳其訊息
async function rejMsg(pm, lb) {
    let state = 'resolved'
    let msg = ''
    try {
        await pm
    }
    catch (e) {
        state = 'rejected'
        msg = String((e && e.message) || e)
    }
    assert.strict.strictEqual(state, 'rejected', `${lb} 應reject`)
    return msg
}

function wantIds(pred) {
    return SEEDS.filter(([, d]) => d !== null && pred(wallNum(d))).map(([id]) => id).sort()
}


if (isWindows()) {
    describe('WOrmMdb 浮動時間: 真Jet端到端(R-FLOAT-00)', function() {

        let nCopy = 0

        before(async function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdModels, { recursive: true })
            fs.copyFileSync('./test/assets/models/tc.js', path.join(fdModels, 'tc.js'))
            fs.copyFileSync('./test/assets/worm_find_def.mdb', fpSeed)
            let jet = jetOpen({ path: path.resolve(fpSeed), password: '' })
            let r = await jet.run(SEEDS.map(([id, d]) => ({
                type: 'execute',
                sql: `INSERT INTO [tc] ([id], [name], [value], [n], [dt], [b]) VALUES ('${id}', 'x', 1, 1, ${d === null ? 'NULL' : `#${d}#`}, 0)`,
            })))
            if (!r.ok) {
                throw new Error(`seed failed: ${r.error}`)
            }
        })

        after(function() {
            try {
                fs.rmSync(fdTmp, { recursive: true, force: true })
            }
            catch (err) {}
        })

        //cp, 取種子之新複本
        function cp() {
            nCopy++
            let fp = `${fdTmp}/c${nCopy}.mdb`
            fs.copyFileSync(fpSeed, fp)
            return fp
        }

        for (let tz of TZS_E2E) {
            it(`${tz}: delAll({dt:{$lt:今日}})只刪牆上時間早於今日者, 不刪9999-12-31 23:59:59哨兵(資料遺失類), 且刪除集合 = select命中集合`, async function() {
                await withTz(tz, async() => {
                    tzProof(tz)
                    let find = () => ({ dt: { $lt: '2026-10-20T00:00:00' } })
                    let want = wantIds((x) => x < wallNum('2026-10-20 00:00:00'))
                    assert.strict.deepStrictEqual(want, ['berskip', 'expired', 'min', 'nyskip'], '預言機')

                    let { w, evs } = mkW(cp())
                    let sel = (await w.select(find())).map((v) => v.id).sort()
                    assert.strict.deepStrictEqual(sel, want, `${tz} select`)

                    let fp = cp()
                    let { w: w2, evs: evs2 } = mkW(fp)
                    let res = await w2.delAll(find())
                    assert.strict.deepStrictEqual(res, { n: want.length, nDeleted: want.length, ok: 1 }, `${tz} delAll回傳`)
                    let left = await readIds(fp)
                    assert.strict.deepStrictEqual(left, ['future', 'never', 'nul', 'nyovl'], `${tz} 剩餘列(哨兵never須保留)`)
                    assert.strict.strictEqual(evs.length + evs2.length, 0, '不發error事件')
                })
            })

            it(`${tz}: 條件(字串/Date/epoch) x 運算子, select命中 = 牆上時間數值比較; 哨兵本身作為條件值不被拒收`, async function() {
                await withTz(tz, async() => {
                    tzProof(tz)
                    let { w } = mkW(fpSeed)
                    let fails = []
                    let nCell = 0
                    for (let [wl, kind] of CONDS) {
                        let cw = wallNum(condWall(wl, kind))
                        for (let op of OPS) {
                            nCell++
                            let want = wantIds((x) => cmpOk(op, x, cw))
                            let got
                            try {
                                got = (await w.select({ dt: { [op]: condVal(wl, kind) } })).map((v) => v.id).sort()
                            }
                            catch (e) {
                                got = `REJECT ${String((e && e.message) || e).slice(0, 100)}`
                            }
                            if (JSON.stringify(got) !== JSON.stringify(want)) {
                                fails.push(`${wl} ${kind} ${op}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
                            }
                        }
                    }
                    assert.strict.strictEqual(CONDS.length * OPS.length, 36, '條件 x 運算子格數')
                    assert.strict.strictEqual(nCell, 36, '執行格數')
                    assert.strict.deepStrictEqual(fails, [], `${tz} ${fails.length}/${nCell}格不符`)
                })
            })

            if (['America/Los_Angeles', 'Europe/Berlin', 'Asia/Taipei'].indexOf(tz) >= 0) {
                it(`${tz}: 同36格逐格delAll, 實刪集合(自Jet讀回剩餘主鍵取差集) = 預言機(與select命中集合同), 回傳筆數 = 實刪列數`, async function() {
                    await withTz(tz, async() => {
                        tzProof(tz)
                        let all = SEEDS.map(([id]) => id).sort()
                        let fails = []
                        let nCell = 0
                        for (let [wl, kind] of CONDS) {
                            let cw = wallNum(condWall(wl, kind))
                            for (let op of OPS) {
                                nCell++
                                let want = wantIds((x) => cmpOk(op, x, cw))
                                let fp = cp()
                                let { w } = mkW(fp)
                                let res
                                try {
                                    res = await w.delAll({ dt: { [op]: condVal(wl, kind) } })
                                }
                                catch (e) {
                                    fails.push(`${wl} ${kind} ${op}: REJECT ${String((e && e.message) || e).slice(0, 100)}`)
                                    continue
                                }
                                let left = await readIds(fp)
                                let deleted = all.filter((id) => left.indexOf(id) < 0)
                                if (JSON.stringify(deleted) !== JSON.stringify(want) || res.n !== want.length || res.nDeleted !== want.length) {
                                    fails.push(`${wl} ${kind} ${op}: deleted ${JSON.stringify(deleted)} want ${JSON.stringify(want)} res ${JSON.stringify(res)}`)
                                }
                                fs.rmSync(fp, { force: true })
                            }
                        }
                        assert.strict.strictEqual(nCell, 36, '執行格數')
                        assert.strict.deepStrictEqual(fails, [], `${tz} ${fails.length}/${nCell}格不符`)
                    })
                })
            }

            it(`${tz}: 以哨兵(Date形式)為條件之delAll只刪哨兵列, select回傳仍為Jet原值字串`, async function() {
                await withTz(tz, async() => {
                    tzProof(tz)
                    let { w } = mkW(fpSeed)
                    let rs = await w.select({ dt: { $gte: condVal('9999-12-31 23:59:59', 'date') } })
                    assert.strict.deepStrictEqual(rs.map((v) => [v.id, v.dt]), [['never', '9999-12-31T23:59:59']], `${tz} select`)
                    let fp = cp()
                    let { w: w2 } = mkW(fp)
                    let res = await w2.delAll({ dt: { $gte: condVal('9999-12-31 23:59:59', 'date') } })
                    assert.strict.deepStrictEqual(res, { n: 1, nDeleted: 1, ok: 1 }, `${tz} delAll回傳`)
                    assert.strict.deepStrictEqual(await readIds(fp), ['berskip', 'expired', 'future', 'min', 'nul', 'nyovl', 'nyskip'], `${tz} 剩餘列`)
                })
            })
        }

    })


    //R-FLOAT-01②: 資料側換算失敗整批拒收(公開API)。model把Jet之TEXT欄fStr宣告為DATE, 該欄存任意文字時無法換算
    describe('WOrmMdb 浮動時間: Jet欄值無法換算時整批拒收(R-FLOAT-01②, 公開API)', function() {

        let nmBad = 'float-e2e-bad'
        let fdBad = `./test/temp-${nmBad}`
        let fdBadModels = `${fdBad}/models`
        let fpBad = `${fdBad}/seed.mdb`
        let nBad = 0

        function mkWTt(fp) {
            let w = wo({ url: 'mdb://:', db: 'worm', cl: 'tt', pk: 'id', fdModels: fdBadModels, storage: fp })
            let evs = []
            w.on('error', (e) => {
                evs.push(e)
            })
            return { w, evs }
        }

        function cpBad() {
            nBad++
            let fp = `${fdBad}/c${nBad}.mdb`
            fs.copyFileSync(fpBad, fp)
            return fp
        }

        before(async function() {
            fs.rmSync(fdBad, { recursive: true, force: true })
            fs.mkdirSync(fdBadModels, { recursive: true })
            let src = fs.readFileSync('./test/assets/models/tt.js', 'utf8')
            let src2 = src.replace(/'fStr': \{(\s*)type: DataTypes\.STRING/, '\'fStr\': {$1type: DataTypes.DATE')
            assert.strict.notStrictEqual(src2, src, 'model修補須生效(fStr宣告為DATE)')
            fs.writeFileSync(path.join(fdBadModels, 'tt.js'), src2)
            fs.copyFileSync('./test/assets/worm_pk_def.mdb', fpBad)
            let jet = jetOpen({ path: path.resolve(fpBad), password: '' })
            let rows = [
                ['a', '#2020-01-01 00:00:00#', '\'garbage\'', 1],
                ['b', '#2099-01-01 00:00:00#', '\'2026-01-01T00:00:00\'', 2],
                ['c', 'NULL', 'NULL', 3],
            ]
            let r = await jet.run([{ type: 'execute', sql: 'DELETE FROM [tt]' }, ...rows.map(([id, d, s, n]) => ({
                type: 'execute',
                sql: `INSERT INTO [tt] ([id], [fDate], [fStr], [fInt]) VALUES ('${id}', ${d}, ${s}, ${n})`,
            }))])
            if (!r.ok) {
                throw new Error(`seed failed: ${r.error}`)
            }
        })

        after(function() {
            try {
                fs.rmSync(fdBad, { recursive: true, force: true })
            }
            catch (err) {}
        })

        it('帶條件之select與delAll(含條件不涉及該欄者)整批reject、資料表不變、每次呼叫恰發一次error事件, 訊息指出欄位且不回顯值', async function() {
            for (let tz of ['America/Los_Angeles', 'Asia/Taipei']) {
                await withTz(tz, async() => {
                    //註: 條件值本身不合法者(如{fStr:'garbage'})由cvFind先行拒收(invalid find), 見unit-float-tz〈拒收原因的先後〉
                    let finds = [{ fInt: 1 }, { id: 'a' }, { fDate: { $lt: '2026-10-20T00:00:00' } }, { fStr: null }]
                    for (let find of finds) {
                        let fp = cpBad()
                        let { w, evs } = mkWTt(fp)
                        //rejMsg以獨立旗標記錄promise是否真的reject(不以初始值null推導, 避免成功回null時誤過)
                        let m1 = await rejMsg(w.select(find), `${tz} select ${JSON.stringify(find)}`)
                        assert.strict.match(m1, /^invalid data: date can not be converted to floating time at \[row\[\d+\]\.fStr\]$/, `${tz} select ${JSON.stringify(find)}`)
                        assert.strict.ok(m1.indexOf('garbage') < 0, '訊息不回顯值')
                        assert.strict.strictEqual(evs.length, 1, `${tz} select error事件數`)

                        let m2 = await rejMsg(w.delAll(find), `${tz} delAll ${JSON.stringify(find)}`)
                        assert.strict.match(m2, /^invalid data: date can not be converted to floating time at \[row\[\d+\]\.fStr\]$/, `${tz} delAll ${JSON.stringify(find)}`)
                        assert.strict.strictEqual(evs.length, 2, `${tz} delAll error事件數`)
                        assert.strict.deepStrictEqual(await readIds(fp, 'tt'), ['a', 'b', 'c'], `${tz} 資料表不變`)
                    }
                })
            }
        })

        it('不帶條件之select()亦經記憶體過濾表(select全表與帶條件同一路徑), 故同樣整批reject(fail-closed, 不因條件為空而放行)', async function() {
            let { w, evs } = mkWTt(cpBad())
            let msg = await rejMsg(w.select(), 'select()')
            assert.strict.match(msg, /^invalid data: date can not be converted to floating time at \[row\[\d+\]\.fStr\]$/)
            assert.strict.strictEqual(evs.length, 1)
        })

        it('欄值改為可換算之牆上時間字串後, 同一欄之範圍條件照常(文字欄宣告為DATE亦以牆上時間比較)', async function() {
            let fp = cpBad()
            let jet = jetOpen({ path: path.resolve(fp), password: '' })
            let r = await jet.run([{ type: 'execute', sql: 'UPDATE [tt] SET [fStr] = \'9999-12-31 23:59:59\' WHERE [id] = \'a\'' }])
            assert.strict.ok(r.ok, 'seed update')
            for (let tz of ['America/Los_Angeles', 'Asia/Taipei']) {
                await withTz(tz, async() => {
                    let { w } = mkWTt(fp)
                    let ids = async(find) => (await w.select(find)).map((v) => v.id).sort()
                    assert.strict.deepStrictEqual(await ids({ fStr: { $lt: '2026-10-20T00:00:00' } }), ['b'], `${tz} 哨兵不小於今日, 只命中b`)
                    assert.strict.deepStrictEqual(await ids({ fStr: { $gte: '9999-12-31T23:59:59' } }), ['a'], `${tz} 哨兵`)
                    assert.strict.deepStrictEqual(await ids({ fStr: { $lte: '2026-01-01T00:00:00' } }), ['b'], `${tz} 2026-01-01`)
                })
            }
        })

    })
}
