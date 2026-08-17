import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md
//本檔涵蓋: 七函數之回傳型別與鍵集合固定(T2)、輸入無效之處置(T5)、select之查詢條件與不含資料庫內部欄位


let nm = 'basic'
let ss = null

if (isWindows()) {
    describe('WOrmMdb basic', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {}) //錯誤斷言於回傳值, 不需console
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        describe('T5 輸入無效之處置', function() {

            it('insert收無效輸入回{n:0,nInserted:0,ok:1}', async function() {
                assert.strict.deepStrictEqual(await w.insert(null), { n: 0, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.insert({}), { n: 0, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.insert([]), { n: 0, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.insert('abc'), { n: 0, nInserted: 0, ok: 1 })
            })

            it('insertBulk收無效輸入回{n:0,nInserted:0,ok:1}', async function() {
                assert.strict.deepStrictEqual(await w.insertBulk(null), { n: 0, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.insertBulk({}), { n: 0, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.insertBulk([]), { n: 0, nInserted: 0, ok: 1 })
            })

            it('save收無效輸入回[]', async function() {
                assert.strict.deepStrictEqual(await w.save(null), [])
                assert.strict.deepStrictEqual(await w.save({}), [])
                assert.strict.deepStrictEqual(await w.save([]), [])
            })

            it('del收無效輸入回[]', async function() {
                assert.strict.deepStrictEqual(await w.del(null), [])
                assert.strict.deepStrictEqual(await w.del({}), [])
                assert.strict.deepStrictEqual(await w.del([]), [])
            })

        })

        describe('T2 回傳型別與鍵集合固定', function() {

            it('select於空表恆回陣列而非null', async function() {
                let rs = await w.select()
                assert.strict.ok(Array.isArray(rs), '須為陣列')
                assert.strict.deepStrictEqual(rs, [])
            })

            it('delAll於空表回{n:0,nDeleted:0,ok:1}', async function() {
                assert.strict.deepStrictEqual(await w.delAll(), { n: 0, nDeleted: 0, ok: 1 })
            })

            it('逐筆函數收單一物件亦回長度1之陣列', async function() {
                let rIns = await w.save({ id: 'k1', name: 'K1', value: 1 })
                assert.strict.ok(Array.isArray(rIns))
                assert.strict.strictEqual(rIns.length, 1)
                let rDel = await w.del({ id: 'k1' })
                assert.strict.ok(Array.isArray(rDel))
                assert.strict.strictEqual(rDel.length, 1)
            })

            it('save四鍵恆同時出現, 不因路徑而異', async function() {
                await w.delAll()
                let ks = ['n', 'nInserted', 'nModified', 'ok']
                let rs = await w.save([
                    { id: 'p1', name: 'P1', value: 1 }, //插入
                    { id: 'p2', name: 'P2', value: 2 }, //插入
                ])
                let rs2 = await w.save([
                    { id: 'p1', name: 'P1-mod' }, //更新
                    { id: 'p2', name: 'P2' }, //合併後相同
                    { id: 'p3', name: 'P3' }, //不存在
                ], { autoInsert: false })
                let all = [...rs, ...rs2]
                all.forEach((v, k) => {
                    assert.strict.deepStrictEqual(Object.keys(v).sort(), [...ks].sort(), `第${k}筆之鍵集合`)
                })
            })

            it('del三鍵恆同時出現, 正常結果不帶err', async function() {
                await w.delAll()
                await w.insert([{ id: 'd1', name: 'D1', value: 1 }])
                let rs = await w.del([
                    { id: 'd1' }, //命中
                    { id: 'd-none' }, //未命中
                ])
                rs.forEach((v, k) => {
                    assert.strict.deepStrictEqual(Object.keys(v).sort(), ['n', 'nDeleted', 'ok'], `第${k}筆之鍵集合`)
                })
            })

            it('insert與insertBulk之鍵集合完全相同', async function() {
                await w.delAll()
                let rA = await w.insert([{ id: 'x1', name: 'X1', value: 1 }])
                let rB = await w.insertBulk([{ id: 'x2', name: 'X2', value: 2 }])
                assert.strict.deepStrictEqual(Object.keys(rA).sort(), Object.keys(rB).sort())
                assert.strict.deepStrictEqual(Object.keys(rA).sort(), ['n', 'nInserted', 'ok'])
            })

        })

        describe('select之查詢條件', function() {

            before(async function() {
                await w.delAll()
                await w.insert([
                    { id: 'id-peter', name: 'peter', value: 123 },
                    { id: 'id-rosemary', name: 'rosemary', value: 123.456 },
                    { id: 'id-kettle', name: 'kettle', value: 456 },
                ])
            })

            it('select全部回三筆且欄位與寫入時一致', async function() {
                let rs = await w.select()
                assert.strict.strictEqual(rs.length, 3)
                let peter = rs.find((v) => v.id === 'id-peter')
                assert.strict.deepStrictEqual(peter, { id: 'id-peter', name: 'peter', value: 123 })
            })

            it('select依主鍵查詢單筆', async function() {
                let rs = await w.select({ id: 'id-rosemary' })
                assert.strict.deepStrictEqual(rs, [{ id: 'id-rosemary', name: 'rosemary', value: 123.456 }])
            })

            it('select複合條件$and+$gt+$lt', async function() {
                let rs = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
                assert.strict.deepStrictEqual(rs, [{ id: 'id-rosemary', name: 'rosemary', value: 123.456 }])
            })

            it('select複合條件$or+$gte+$lte', async function() {
                let rs = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
                assert.strict.strictEqual(rs.length, 1)
                assert.strict.strictEqual(rs[0].name, 'kettle')
            })

            it('select複合條件$or+$and+$ne+$in+$nin', async function() {
                let rs = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
                assert.strict.strictEqual(rs.length, 2)
                assert.strict.strictEqual(rs[0].id, 'id-rosemary')
                assert.strict.strictEqual(rs[1].name, 'kettle')
            })

            it('select以$regex不分大小寫查詢', async function() {
                let rs = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
                assert.strict.deepStrictEqual(rs, [{ id: 'id-peter', name: 'peter', value: 123 }])
            })

            it('select無符合數據回空陣列', async function() {
                let rs = await w.select({ name: 'nobody' })
                assert.strict.deepStrictEqual(rs, [])
            })

            it('select之字串比對不分大小寫, 與Jet引擎一致', async function() {
                //Jet之字串比對不分大小寫(已實測), 記憶體過濾層已對齊,
                //否則會出現[selectByPk命中而select({主鍵})查無]之矛盾
                let rs = await w.select({ id: 'ID-PETER' })
                assert.strict.strictEqual(rs.length, 1)
                assert.strict.strictEqual(rs[0].id, 'id-peter')
            })

        })

        describe('數據往返無損', function() {

            it('中文與特殊字元寫入讀回無損', async function() {
                await w.delAll()
                let v = { id: `it's-中文`, name: `O'Brien "雙引號" \\反斜線 中文標題測試繁體字`, value: 123.456789012345 }
                await w.insert([v])
                let rs = await w.select()
                assert.strict.deepStrictEqual(rs, [v])
            })

            it('數值0與負值不被誤判', async function() {
                await w.delAll()
                await w.insert([
                    { id: 'z-zero', name: 'zero', value: 0 },
                    { id: 'z-neg', name: 'neg', value: -12.5 },
                ])
                let rs = await w.select({ value: 0 })
                assert.strict.strictEqual(rs.length, 1)
                assert.strict.strictEqual(rs[0].value, 0)
                let rs2 = await w.select({ value: -12.5 })
                assert.strict.strictEqual(rs2.length, 1)
            })

        })

    })
}
