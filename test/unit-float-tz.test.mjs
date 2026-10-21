/* eslint-disable no-new-wrappers */ //本檔刻意以new String建構包裝物件, 驗證DATE欄資料值為非Date物件時整批拒收
import assert from 'assert'
import Sequelize from 'sequelize'
import { isWindows } from './unit-setup.mjs'
import withTz from './tools/withTz.mjs'
import { TZS, TZS_NEG, tzProof, mkLocal, wallNum, wallMs, wallOfInstantIn, condVal, condWall, cmpOk } from './tools/floatTools.mjs'
import { queryMemory } from '../src/queryMemory.mjs'


//spec: CLAUDE_rulebook.md之R-FLOAT(非主鍵日期條件之浮動時間; 第87項B4)。事實出處: Jet 4.0之DATETIME為無時區牆上時間(select回傳2026-01-01T00:00:00), 無夏令
//  R-FLOAT-00 日期條件(字串、Date、epoch)與Jet列之DATE值於記憶體過濾表處於同一浮動空間, 命中判定 = 牆上時間之數值比較(無時區字串條件與主機時區無關; 固定瞬間之Date/epoch/帶時區字串取主機本地分量, 其牆上意義隨主機時區而異, 見LFL2)
//  R-FLOAT-01② DATE欄資料值經toFloating換算, 失敗(null)整批拒收, 不得以原值或NULL代入; null/undefined不動
//  R-FLOAT-01① select之內容仍為Jet原值(字串), 輸入之data不被改動
//本檔: queryMemory層(無Jet)之時區矩陣——10時區 x 25個[條件值, 形式]配對(字串/Date/epoch) x 6運算子 + 3組$in/$nin(共156格/時區), 預言機為牆上時間數值比較;
//  另有條件文法(省略秒、小數位數、年0001–0099)、固定瞬間形式(帶Z或偏移之字串、Date、epoch)、資料側換算與拒收、回傳列序; 真Jet端到端見unit-float-e2e.test.mjs
//註: 修前(dateNoTz:'local')於負偏移時區, 9999-12-31 23:59:59列存為UTC年10000之文字而字典序小於2026-…, 範圍條件結果錯誤且該時刻作條件值被拒; 夏令跳過之牆上時刻亦被正規化


//Jet回傳格式(yyyy-MM-ddTHH:mm:ss)之牆上時間; 含哨兵、年100、Jet之時間值基準日1899-12-30、各夏令區之跳過與重疊時刻、NULL
const WALLS = [
    '2020-01-01T00:00:00', '2026-10-19T23:59:59', '2026-10-20T00:00:00', '2026-10-20T12:34:56', '2026-12-31T23:59:59', '2027-01-01T00:00:00', '2099-01-01T00:00:00',
    '9999-12-31T00:00:00', '9999-12-31T12:00:00', '9999-12-31T23:59:59', '0100-01-01T00:00:00', '0100-01-01T12:00:00', '1899-12-30T08:30:00',
    '2026-03-08T01:59:59', '2026-03-08T02:30:00', '2026-03-08T03:00:00', '2026-11-01T00:59:59', '2026-11-01T01:30:00', '2026-11-01T02:00:00', //美東: 夏令跳過(02:00–03:00)與重疊(01:00–02:00)
    '2026-03-29T01:59:59', '2026-03-29T02:30:00', '2026-03-29T03:00:00', '2026-10-25T02:30:00', //柏林: 跳過與重疊
    '2026-10-04T02:15:00', '2027-04-04T01:45:00', //Lord Howe: 跳過(半小時)與重疊
    null,
]
const ROWS = WALLS.map((d, i) => ({ id: `r${String(i).padStart(2, '0')}`, d }))

//條件值(牆上時間意義 + 形式): 字串(無時區)、以本地分量建構之Date、其epoch
const CONDS = [
    ['2026-10-20 00:00:00', 'str'], ['9999-12-31 23:59:59', 'str'], ['2020-01-01 00:00:00', 'str'], ['2099-01-01 00:00:00', 'str'], ['0100-01-01 00:00:00', 'str'],
    ['2026-03-08 02:30:00', 'str'], ['2026-11-01 01:30:00', 'str'], ['9999-12-31 00:00:00', 'str'], ['2026-12-31 23:59:59', 'str'],
    ['2026-10-20 00:00:00', 'date'], ['9999-12-31 23:59:59', 'date'], ['2020-01-01 00:00:00', 'date'], ['0100-01-01 00:00:00', 'date'], ['2026-11-01 01:30:00', 'date'],
    ['2026-10-20 00:00:00', 'epoch'], ['9999-12-31 23:59:59', 'epoch'],
    ['2026-03-29 03:00:00', 'str'], ['2026-10-04 02:30:00', 'str'],
    ['2026-03-29 02:30:00', 'str'], ['2026-10-04 02:15:00', 'str'], ['2026-10-25 02:30:00', 'str'], ['2027-04-04 01:45:00', 'str'], //夏令跳過與重疊時刻本身作為條件值
    ['2026-03-29 02:30:00', 'date'], ['2026-10-04 02:15:00', 'date'], ['2026-03-08 02:30:00', 'date'], //夏令跳過之時刻以Date建構(JS已將其正規化, 預言機取結果Date之本地分量)
]
const OPS = ['$lt', '$lte', '$gt', '$gte', '$eq', '$ne']

const attrs = {
    id: { type: Sequelize.STRING },
    d: { type: Sequelize.DATE },
}
const opt = { cl: 'tfloat', logging: false }

//qm, 取命中之id(排序後)
async function qm(find, data = ROWS) {
    let rs = await queryMemory(opt, attrs, data, find)
    return rs.map((v) => v.id).sort()
}

//msgOf
function msgOf(e) {
    return String(e && e.message !== undefined ? e.message : e)
}

//wantIds, 預言機: 牆上時間數值比較; NULL列於比較不命中(SQL三值)
function wantIds(pred) {
    return ROWS.filter((r) => r.d !== null && pred(wallNum(r.d))).map((r) => r.id).sort()
}


if (isWindows()) {
    describe('WOrmMdb 浮動時間: 時區矩陣(queryMemory層, R-FLOAT-00)', function() {

        for (let tz of TZS) {
            it(`${tz}: ${CONDS.length}個條件 x ${OPS.length}個運算子 + $in/$nin, 命中 = 牆上時間數值比較`, async function() {
                await withTz(tz, async() => {
                    tzProof(tz) //自證時區確實生效
                    let fails = []
                    let nCell = 0
                    let nPos = 0
                    for (let [w, kind] of CONDS) {
                        let cw = wallNum(condWall(w, kind))
                        for (let op of OPS) {
                            nCell++
                            let want = wantIds((x) => cmpOk(op, x, cw))
                            if (want.length > 0) {
                                nPos++
                            }
                            let got
                            try {
                                got = await qm({ d: { [op]: condVal(w, kind) } })
                            }
                            catch (e) {
                                got = `REJECT ${msgOf(e).slice(0, 100)}`
                            }
                            if (JSON.stringify(got) !== JSON.stringify(want)) {
                                fails.push(`${w} ${kind} ${op}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
                            }
                        }
                    }

                    //$in/$nin, 元素皆套用同一換算
                    for (let [kind, ws] of [['str', ['2020-01-01 00:00:00', '9999-12-31 23:59:59']], ['date', ['2020-01-01 00:00:00', '9999-12-31 23:59:59']], ['str', ['2026-03-29 02:30:00', '2026-11-01 01:30:00', '0100-01-01 00:00:00']]]) {
                        let set = ws.map((w) => wallNum(condWall(w, kind)))
                        for (let op of ['$in', '$nin']) {
                            nCell++
                            let want = wantIds((x) => (op === '$in') === (set.indexOf(x) >= 0))
                            if (want.length > 0) {
                                nPos++
                            }
                            let got
                            try {
                                got = await qm({ d: { [op]: ws.map((w) => condVal(w, kind)) } })
                            }
                            catch (e) {
                                got = `REJECT ${msgOf(e).slice(0, 100)}`
                            }
                            if (JSON.stringify(got) !== JSON.stringify(want)) {
                                fails.push(`${op} ${kind} ${JSON.stringify(ws)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
                            }
                        }
                    }
                    //格數為固定常數(防空轉: 條件或運算子清單被清空時不得靠空迴圈全綠): 25條件 x 6運算子 + 3組 x 2 = 156
                    assert.strict.strictEqual(CONDS.length, 25, '條件數')
                    assert.strict.strictEqual(OPS.length, 6, '運算子數')
                    assert.strict.strictEqual(nCell, 156, '執行格數')
                    assert.strict.ok(nPos > nCell / 2, `預言機過半數格須有命中(防空轉), ${nPos}/${nCell}`)
                    assert.strict.deepStrictEqual(fails, [], `${tz} ${fails.length}/${nCell}格不符`)
                })
            })
        }

        it('哨兵: 每個時區的delAll/select({d:{$lt:今日}})只命中expired, 不命中9999-12-31 23:59:59(資料遺失類)', async function() {
            let rows = [{ id: 'expired', d: '2020-01-01T00:00:00' }, { id: 'never', d: '9999-12-31T23:59:59' }, { id: 'future', d: '2099-01-01T00:00:00' }]
            for (let tz of TZS) {
                await withTz(tz, async() => {
                    assert.strict.deepStrictEqual(await qm({ d: { $lt: '2026-10-20T00:00:00' } }, rows), ['expired'], tz)
                    assert.strict.deepStrictEqual(await qm({ d: { $lt: mkLocal(2026, 10, 20) } }, rows), ['expired'], `${tz} Date`)
                    assert.strict.deepStrictEqual(await qm({ d: { $lt: mkLocal(2026, 10, 20).getTime() } }, rows), ['expired'], `${tz} epoch`)
                    assert.strict.deepStrictEqual(await qm({ d: { $gte: '2026-10-20T00:00:00' } }, rows), ['future', 'never'], `${tz} $gte`)
                })
            }
        })

        it('哨兵本身作為條件值不被拒收(修前負偏移時區換算UTC年10000而reject), 字串、Date、epoch皆命中never', async function() {
            let rows = [{ id: 'expired', d: '2020-01-01T00:00:00' }, { id: 'never', d: '9999-12-31T23:59:59' }, { id: 'future', d: '2099-01-01T00:00:00' }]
            for (let tz of TZS) {
                await withTz(tz, async() => {
                    for (let [lb, v] of [['str', '9999-12-31T23:59:59'], ['str空白', '9999-12-31 23:59:59'], ['Date', mkLocal(9999, 12, 31, 23, 59, 59)], ['epoch', mkLocal(9999, 12, 31, 23, 59, 59).getTime()]]) {
                        assert.strict.deepStrictEqual(await qm({ d: { $gte: v } }, rows), ['never'], `${tz} ${lb} $gte`)
                        assert.strict.deepStrictEqual(await qm({ d: { $eq: v } }, rows), ['never'], `${tz} ${lb} $eq`)
                        assert.strict.deepStrictEqual(await qm({ d: { $ne: v } }, rows), ['expired', 'future'], `${tz} ${lb} $ne`)
                    }
                })
            }
        })

        it('負偏移時區自證: 4個時區皆使9999-12-31 23:59:59之UTC年為10000(防止時區未生效而以UTC行為全綠)', async function() {
            for (let tz of TZS_NEG) {
                await withTz(tz, () => {
                    assert.strict.ok(mkLocal(9999, 12, 31, 23, 59, 59).toISOString().startsWith('+010000-'), tz)
                    tzProof(tz)
                })
            }
        })

        it('同一空間: 每一列的牆上時間字串作為$eq條件, 命中恰為該列(含夏令跳過/重疊與哨兵), 各時區', async function() {
            for (let tz of TZS) {
                await withTz(tz, async() => {
                    for (let r of ROWS) {
                        if (r.d === null) {
                            continue
                        }
                        let exp = ROWS.filter((x) => x.d === r.d).map((x) => x.id)
                        assert.strict.deepStrictEqual(await qm({ d: r.d }), exp, `${tz} ${r.d}`)
                    }
                })
            }
        })

    })


    describe('WOrmMdb 浮動時間: 資料側換算與拒收(R-FLOAT-01②、01①)', function() {

        //tzs, 取負偏移、UTC+有夏令、UTC+無夏令各一
        const TZ3 = ['America/Los_Angeles', 'Europe/Berlin', 'Asia/Taipei']

        it('select之內容仍為Jet原值(字串), 輸入之data不被改動(R-FLOAT-01①)', async function() {
            let data = [{ id: 'a', d: '2020-01-01T00:00:00' }, { id: 'b', d: null }, { id: 'c', d: '9999-12-31T23:59:59' }]
            let snap = JSON.stringify(data)
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    let rs = await queryMemory(opt, attrs, data, { d: { $gte: '2020-01-01T00:00:00' } })
                    assert.strict.deepStrictEqual(rs, [data[0], data[2]], tz)
                    assert.strict.strictEqual(rs[0], data[0], '回傳原列物件')
                    assert.strict.strictEqual(typeof rs[1].d, 'string')
                    assert.strict.strictEqual(JSON.stringify(data), snap, `${tz} data未被改動`)
                })
            }
        })

        it('null、undefined之DATE值不動: {d:null}命中、範圍條件不命中', async function() {
            let data = [{ id: 'a', d: '2020-01-01T00:00:00' }, { id: 'n', d: null }, { id: 'u', d: undefined }, { id: 'x' }]
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    assert.strict.deepStrictEqual(await qm({ d: null }, data), ['n', 'u', 'x'], `${tz} IS NULL`)
                    assert.strict.deepStrictEqual(await qm({ d: { $lt: '2099-01-01T00:00:00' } }, data), ['a'], `${tz} 範圍`)
                    assert.strict.deepStrictEqual(await qm({ d: { $ne: null } }, data), ['a'], `${tz} $ne null`)
                })
            }
        })

        //轉換失敗(toFloating為null)者整批拒收, 不得以原值或NULL代入; 訊息不回顯值
        const BAD = [
            ['非日期字串', 'garbage'], ['空字串', ''], ['純日期', '2026-01-01'], ['2月30日', '2026-02-30T00:00:00'], ['24時', '2026-01-01T24:00:00'], ['月13', '2026-13-01T00:00:00'],
            ['年0', '0000-01-01T00:00:00'], ['前後空白', ' 2026-01-01T00:00:00'], ['小寫t', '2026-01-01t00:00:00'], ['5位年', '10000-01-01T00:00:00'], ['時間加Z之亂字串', 'xx:yy:zz'],
            ['布林true', true], ['布林false', false], ['空物件', {}], ['陣列', ['2026-01-01T00:00:00']], ['NaN', NaN], ['Infinity', Infinity], ['Invalid Date', new Date(NaN)], ['BigInt', 10n],
            ['包裝字串物件', new String('2026-01-01T00:00:00')], ['超出Date範圍之數值', 8.64e15 + 1],
        ]
        for (let [lb, bad] of BAD) {
            it(`轉換失敗整批拒收: DATE值為${lb}, 於任一列皆reject且不回顯值(R-FLOAT-01②)`, async function() {
                for (let tz of TZ3) {
                    await withTz(tz, async() => {
                        for (let pos of [0, 1, 2]) {
                            let data = [{ id: 'a', d: '2020-01-01T00:00:00' }, { id: 'b', d: '2099-01-01T00:00:00' }, { id: 'c', d: null }]
                            data[pos] = { id: 'bad', d: bad }
                            //條件即使不引用d欄(僅id)亦拒收: 整批性
                            for (let find of [{ d: { $lt: '2026-01-01T00:00:00' } }, { id: 'a' }, { d: null }]) {
                                let msg = ''
                                let rs = null
                                try {
                                    rs = await queryMemory(opt, attrs, data, find)
                                }
                                catch (e) {
                                    msg = msgOf(e)
                                }
                                assert.strict.strictEqual(rs, null, `${tz} ${lb} 位置${pos} ${JSON.stringify(find)} 應reject`)
                                //完整標準訊息(固定詞彙, 只有列索引與欄名為參數): 任何型別之壞值皆不得被回顯(含布林、數值、物件)
                                assert.strict.strictEqual(msg, `invalid data: date can not be converted to floating time at [row[${pos}].d]`, `${tz} ${lb} 位置${pos}`)
                            }
                        }
                    })
                }
            })
        }

        it('非字串之有效DATE值(Date、epoch)與條件側同一規則: 本地分量作為牆上時間', async function() {
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    let w = mkLocal(2020, 1, 1, 0, 0, 0)
                    let data = [{ id: 's', d: '2020-01-01T00:00:00' }, { id: 'dt', d: mkLocal(2020, 1, 1, 0, 0, 0) }, { id: 'ep', d: w.getTime() }, { id: 'o', d: '2021-01-01T00:00:00' }]
                    assert.strict.deepStrictEqual(await qm({ d: '2020-01-01T00:00:00' }, data), ['dt', 'ep', 's'], `${tz} 字串條件`)
                    assert.strict.deepStrictEqual(await qm({ d: mkLocal(2020, 1, 1) }, data), ['dt', 'ep', 's'], `${tz} Date條件`)
                    assert.strict.deepStrictEqual(await qm({ d: { $gt: '2020-01-01T00:00:00' } }, data), ['o'], `${tz} 範圍`)
                })
            }
        })

        it('拒收原因的先後(條件 合法/不合法 x 資料 合法/不合法): 條件不合法者一律以cvFind之invalid find/欄位錯誤為準(先於資料列換算); 條件合法而資料不合法則為invalid data', async function() {
            let good = [{ id: 'a', d: '2020-01-01T00:00:00' }]
            let bad = [{ id: 'a', d: 'garbage' }]
            //條件合法 x 資料合法: 正常
            assert.strict.deepStrictEqual(await qm({ id: 'a' }, good), ['a'])
            //條件不合法 x 資料合法
            await assert.rejects(queryMemory(opt, attrs, good, { zz: 1 }), /unknown column name/)
            await assert.rejects(queryMemory(opt, attrs, good, { d: 'garbage' }), /^Error: invalid find: value \[garbage\] does not match column type \[date\]/)
            //條件合法 x 資料不合法
            await assert.rejects(queryMemory(opt, attrs, bad, { id: 'a' }), /^Error: invalid data: date can not be converted to floating time at \[row\[0\]\.d\]$/)
            //條件不合法 x 資料不合法: 條件先(資料換算尚未發生, 不得以invalid data掩蓋)
            await assert.rejects(queryMemory(opt, attrs, bad, { zz: 1 }), /unknown column name/)
            await assert.rejects(queryMemory(opt, attrs, bad, { d: 'garbage' }), /^Error: invalid find: value \[garbage\] does not match column type \[date\]/)
        })

        it('多個DATE欄各自換算(第二個DATE欄之哨兵於負偏移時區亦不錯亂)', async function() {
            let attrs2 = { id: { type: Sequelize.STRING }, d: { type: Sequelize.DATE }, d2: { type: Sequelize.DATE } }
            let data = [
                { id: 'a', d: '2020-01-01T00:00:00', d2: '9999-12-31T23:59:59' },
                { id: 'b', d: '9999-12-31T23:59:59', d2: '2020-01-01T00:00:00' },
                { id: 'c', d: null, d2: '2099-01-01T00:00:00' },
            ]
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    let ids = async(find) => (await queryMemory(opt, attrs2, data, find)).map((v) => v.id).sort()
                    assert.strict.deepStrictEqual(await ids({ d2: { $lt: '2026-10-20T00:00:00' } }), ['b'], `${tz} d2`)
                    assert.strict.deepStrictEqual(await ids({ d: { $lt: '2026-10-20T00:00:00' } }), ['a'], `${tz} d`)
                    assert.strict.deepStrictEqual(await ids({ d2: { $gte: '9999-12-31T23:59:59' } }), ['a'], `${tz} d2哨兵`)
                    assert.strict.deepStrictEqual(await ids({ $and: [{ d: { $lt: '2099-01-01T00:00:00' } }, { d2: { $gt: '2026-10-20T00:00:00' } }] }), ['a'], `${tz} 兩欄`)
                })
            }
            //第二個DATE欄之值不合法: 同樣整批拒收且指出欄位
            await assert.rejects(queryMemory(opt, attrs2, [{ id: 'a', d: null, d2: 'garbage' }], { id: 'a' }), /^Error: invalid data: .*row\[0\]\.d2/)
        })

        it('條件文法: 省略秒、小數位數(1–4位, 取前三位截斷)、空白分隔、年0001–0099、閏日, 各形式皆換算為牆上時間再比較(預言機另行解析文法)', async function() {
            const GRAM_ROWS = [
                ['g0', '2026-01-01T00:00:00'], ['g1', '2026-01-01T00:00:00.500'], ['g2', '2026-01-01T00:00:00.050'], ['g3', '2026-01-01T00:00:00.005'],
                ['g4', '2026-01-01T00:01:00'], ['g5', '2026-01-01T00:00:01'], ['g6', '0100-01-01T00:00:00'], ['g7', '9999-12-31T23:59:59.999'],
                ['g8', '2026-02-28T23:59:59'], ['g9', '2024-02-29T12:00:00'], ['g10', '9999-12-31T23:59:59'],
            ].map(([id, d]) => ({ id, d }))
            const GRAM = [
                '2026-01-01T00:00', '2026-01-01 00:00', '2026-01-01T00:00:00', '2026-01-01 00:00:00',
                '2026-01-01T00:00:00.5', '2026-01-01T00:00:00.50', '2026-01-01T00:00:00.500', '2026-01-01T00:00:00.5000', '2026-01-01T00:00:00.5009',
                '2026-01-01T00:00:00.05', '2026-01-01T00:00:00.005', '2026-01-01T00:00:00.0059', '2026-01-01 00:01', '2026-01-01T00:00:01.0',
                '0099-12-31T23:59:59', '0001-01-01T00:00:00', '0050-06-15T12:00:00', '0100-01-01T00:00:00',
                '9999-12-31T23:59:59.999', '9999-12-31T23:59:59.9999', '9999-12-31 23:59:59', '2024-02-29T12:00', '2026-02-28T23:59:59.999',
            ]
            assert.strict.strictEqual(GRAM.length, 23, '文法條件數')
            for (let tz of [...TZ3, 'Etc/GMT+12']) {
                await withTz(tz, async() => {
                    tzProof(tz)
                    let nCell = 0
                    let fails = []
                    for (let s of GRAM) {
                        for (let op of ['$eq', '$lt', '$gt']) {
                            nCell++
                            let want = GRAM_ROWS.filter((r) => cmpOk(op, wallMs(r.d), wallMs(s))).map((r) => r.id).sort()
                            let got
                            try {
                                got = await qm({ d: { [op]: s } }, GRAM_ROWS)
                            }
                            catch (e) {
                                got = `REJECT ${msgOf(e).slice(0, 100)}`
                            }
                            if (JSON.stringify(got) !== JSON.stringify(want)) {
                                fails.push(`${s} ${op}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
                            }
                        }
                    }
                    assert.strict.strictEqual(nCell, 69, '執行格數')
                    assert.strict.deepStrictEqual(fails, [], `${tz} ${fails.length}/${nCell}格不符`)
                })
            }
        })

        it('固定瞬間形式: 帶Z或偏移之字串、Date、epoch取該瞬間於主機時區之本地分量為牆上時間(預言機取自ICU而非受測碼)', async function() {
            const INST = [
                ['2026-01-01T00:00:00Z', Date.UTC(2026, 0, 1, 0, 0, 0)],
                ['2026-01-01T00:00:00+08:00', Date.UTC(2025, 11, 31, 16, 0, 0)],
                ['2026-01-01T00:00:00+0800', Date.UTC(2025, 11, 31, 16, 0, 0)],
                ['2026-06-15T12:00:00-07:00', Date.UTC(2026, 5, 15, 19, 0, 0)],
                ['2026-01-01T05:45:00+05:45', Date.UTC(2026, 0, 1, 0, 0, 0)],
                ['2026-03-08T10:00:00.250Z', Date.UTC(2026, 2, 8, 10, 0, 0, 250)], //美東夏令切換日
                ['2026-11-01T06:30:00Z', Date.UTC(2026, 10, 1, 6, 30, 0)], //美東夏令重疊之第二次01:30(EST)
                ['2026-10-04T15:45:00Z', Date.UTC(2026, 9, 4, 15, 45, 0)], //Lord Howe夏令切換日
                ['2026-12-31T23:59:59-12:00', Date.UTC(2027, 0, 1, 11, 59, 59)],
            ]
            const pad3 = (n) => String(n).padStart(3, '0')
            for (let tz of [...TZ3, 'America/New_York', 'Australia/Lord_Howe', 'Etc/GMT+12', 'UTC']) {
                await withTz(tz, async() => {
                    tzProof(tz)
                    //每個瞬間之預期牆上時間(ICU), 列為其本身與前後一小時
                    let want = INST.map(([, ms]) => {
                        let w = wallOfInstantIn(tz, ms).replace(' ', 'T')
                        return ms % 1000 === 0 ? w : `${w}.${pad3(ms % 1000)}`
                    })
                    let rows = []
                    want.forEach((w, i) => {
                        let base = wallMs(w)
                        for (let [k, dh] of [['m', -1], ['e', 0], ['p', 1]]) {
                            let t = new Date(base + dh * 3600000)
                            let s = t.toISOString().replace('Z', '').replace(/^\+?0*(\d{4})/, '$1')
                            rows.push({ id: `${k}${i}`, d: s })
                        }
                    })
                    let nCell = 0
                    let cells = []
                    INST.forEach(([s, ms], i) => {
                        for (let [form, v] of [['str', s], ['Date', new Date(ms)], ['epoch', ms]]) {
                            for (let op of ['$eq', '$lt', '$gt']) {
                                nCell++
                                let wantIds = rows.filter((r) => cmpOk(op, wallMs(r.d), wallMs(want[i]))).map((r) => r.id).sort()
                                cells.push({ form, s, op, v, wantIds })
                            }
                        }
                    })
                    let bad = []
                    for (let c of cells) {
                        let got
                        try {
                            got = await qm({ d: { [c.op]: c.v } }, rows)
                        }
                        catch (e) {
                            got = `REJECT ${msgOf(e).slice(0, 100)}`
                        }
                        if (JSON.stringify(got) !== JSON.stringify(c.wantIds)) {
                            bad.push(`${c.form} ${c.s} ${c.op}: got ${JSON.stringify(got)} want ${JSON.stringify(c.wantIds)}`)
                        }
                    }
                    assert.strict.strictEqual(nCell, 81, '執行格數')
                    assert.strict.deepStrictEqual(bad, [], `${tz} ${bad.length}/${nCell}格不符`)
                })
            }
        })

        it('回傳列序 = Jet回傳序(輸入data之相對順序), 不依id或日期排序', async function() {
            let data = [{ id: 'z', d: '2026-03-01T00:00:00' }, { id: 'a', d: '2026-01-01T00:00:00' }, { id: 'm', d: '2026-02-01T00:00:00' }, { id: 'n', d: null }]
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    let order = async(find) => (await queryMemory(opt, attrs, data, find)).map((v) => v.id)
                    assert.strict.deepStrictEqual(await order({ d: { $gte: '2026-01-01T00:00:00' } }), ['z', 'a', 'm'], `${tz} $gte`)
                    assert.strict.deepStrictEqual(await order({ d: { $gt: '2026-01-15T00:00:00' } }), ['z', 'm'], `${tz} $gt`)
                    assert.strict.deepStrictEqual(await order({}), ['z', 'a', 'm', 'n'], `${tz} 空條件`)
                })
            }
        })

        it('含毫秒之Jet值(yyyy-MM-ddTHH:mm:ss.fff)取至毫秒比較, 空白分隔亦收', async function() {
            let data = [
                { id: 'a', d: '2026-01-01T00:00:00' },
                { id: 'b', d: '2026-01-01T00:00:00.500' },
                { id: 'c', d: '2026-01-01 00:00:01' },
                { id: 'e', d: '9999-12-31T23:59:59.999' },
            ]
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    let ids = async(find) => (await queryMemory(opt, attrs, data, find)).map((v) => v.id).sort()
                    assert.strict.deepStrictEqual(await ids({ d: '2026-01-01T00:00:00' }), ['a'], `${tz} $eq不含毫秒列`)
                    assert.strict.deepStrictEqual(await ids({ d: '2026-01-01T00:00:00.500' }), ['b'], `${tz} $eq毫秒`)
                    assert.strict.deepStrictEqual(await ids({ d: { $gt: '2026-01-01T00:00:00' } }), ['b', 'c', 'e'], `${tz} $gt`)
                    assert.strict.deepStrictEqual(await ids({ d: { $lt: '2026-01-01T00:00:01' } }), ['a', 'b'], `${tz} $lt`)
                    assert.strict.deepStrictEqual(await ids({ d: { $gte: '9999-12-31T23:59:59.999' } }), ['e'], `${tz} 哨兵含毫秒`)
                })
            }
        })

        it('非DATE欄不換算也不檢核: 字串欄之日期樣字串與亂字串照常比對; DATEONLY欄(合成之純日期值)不換算, 維持純日期比對', async function() {
            let attrs3 = { id: { type: Sequelize.STRING }, s: { type: Sequelize.STRING }, dd: { type: Sequelize.DATEONLY }, d: { type: Sequelize.DATE } }
            let data = [
                { id: 'a', s: 'garbage', dd: '2026-01-01', d: '2020-01-01T00:00:00' },
                { id: 'b', s: '2026-01-01T00:00:00', dd: '2026-06-01', d: '9999-12-31T23:59:59' },
            ]
            for (let tz of TZ3) {
                await withTz(tz, async() => {
                    let ids = async(find) => (await queryMemory(opt, attrs3, data, find)).map((v) => v.id).sort()
                    assert.strict.deepStrictEqual(await ids({ s: 'garbage' }), ['a'], `${tz} 字串欄亂字串`)
                    assert.strict.deepStrictEqual(await ids({ s: '2026-01-01T00:00:00' }), ['b'], `${tz} 字串欄日期樣字串`)
                    assert.strict.deepStrictEqual(await ids({ dd: '2026-01-01' }), ['a'], `${tz} DATEONLY`)
                    assert.strict.deepStrictEqual(await ids({ dd: { $gt: '2026-03-01' } }), ['b'], `${tz} DATEONLY範圍`)
                    assert.strict.deepStrictEqual(await ids({ d: { $gt: '2099-01-01T00:00:00' } }), ['b'], `${tz} 同表DATE欄`)
                })
            }
        })

    })
}
