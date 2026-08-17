import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 delAll(find)
//n與nDeleted皆為實際刪除筆數, n不得取全表筆數; find未給或為空物件時刪除全部數據


let nm = 'delall'
let ss = null

if (isWindows()) {
    describe('WOrmMdb delAll', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {})
        })

        beforeEach(async function() {
            await w.delAll()
            await w.insert([
                { id: 'a', name: 'peter', value: 10 },
                { id: 'b', name: 'rosemary', value: 20 },
                { id: 'c', name: 'kettle', value: 30 },
                { id: 'd', name: 'peterson', value: 40 },
            ])
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('find未給時刪除全部數據', async function() {
            let res = await w.delAll()
            assert.strict.deepStrictEqual(res, { n: 4, nDeleted: 4, ok: 1 })
            assert.strict.deepStrictEqual(await w.select(), [])
        })

        it('find為空物件時刪除全部數據', async function() {
            let res = await w.delAll({})
            assert.strict.deepStrictEqual(res, { n: 4, nDeleted: 4, ok: 1 })
        })

        it('條件無命中時回{n:0,nDeleted:0,ok:1}且不視為錯誤', async function() {
            let res = await w.delAll({ name: 'nobody' })
            assert.strict.deepStrictEqual(res, { n: 0, nDeleted: 0, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 4, '不得誤刪')
        })

        it('帶條件且僅部份命中時n為實際刪除筆數而非全表筆數', async function() {
            let res = await w.delAll({ value: { $gt: 25 } })
            assert.strict.deepStrictEqual(res, { n: 2, nDeleted: 2, ok: 1 })
            let rs = await w.select()
            assert.strict.strictEqual(rs.length, 2)
            assert.strict.deepStrictEqual(rs.map((v) => v.id).sort(), ['a', 'b'])
        })

        it('帶條件僅命中一筆', async function() {
            let res = await w.delAll({ id: 'a' })
            assert.strict.deepStrictEqual(res, { n: 1, nDeleted: 1, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 3)
        })

        it('刪除範圍與select(find)之結果一致: $in', async function() {
            let find = { id: { $in: ['a', 'c'] } }
            let expect = await w.select(find)
            assert.strict.strictEqual(expect.length, 2)
            let res = await w.delAll(find)
            assert.strict.deepStrictEqual(res, { n: 2, nDeleted: 2, ok: 1 })
        })

        it('刪除範圍與select(find)之結果一致: $nin', async function() {
            let find = { id: { $nin: ['a'] } }
            let expect = await w.select(find)
            assert.strict.strictEqual(expect.length, 3)
            let res = await w.delAll(find)
            assert.strict.deepStrictEqual(res, { n: 3, nDeleted: 3, ok: 1 })
            assert.strict.deepStrictEqual((await w.select()).map((v) => v.id), ['a'])
        })

        it('刪除範圍與select(find)之結果一致: $regex', async function() {
            let find = { name: { $regex: 'PeT', $options: '$i' } }
            let expect = await w.select(find)
            assert.strict.strictEqual(expect.length, 2, 'peter與peterson')
            let res = await w.delAll(find)
            assert.strict.deepStrictEqual(res, { n: 2, nDeleted: 2, ok: 1 })
            assert.strict.deepStrictEqual((await w.select()).map((v) => v.id).sort(), ['b', 'c'])
        })

        it('刪除範圍與select(find)之結果一致: 複合條件', async function() {
            let find = { '$or': [{ value: { '$lte': 10 } }, { value: { '$gte': 40 } }] }
            let expect = await w.select(find)
            assert.strict.strictEqual(expect.length, 2)
            let res = await w.delAll(find)
            assert.strict.deepStrictEqual(res, { n: 2, nDeleted: 2, ok: 1 })
        })

        it('於空表執行回{n:0,nDeleted:0,ok:1}', async function() {
            await w.delAll()
            assert.strict.deepStrictEqual(await w.delAll(), { n: 0, nDeleted: 0, ok: 1 })
            assert.strict.deepStrictEqual(await w.delAll({ id: 'a' }), { n: 0, nDeleted: 0, ok: 1 })
        })

        it('大量數據帶條件刪除時分批送出且筆數精確', async function() {
            await w.delAll()
            let rs = []
            for (let i = 0; i < 450; i++) {
                rs.push({ id: `k${i}`, name: `N${i}`, value: i })
            }
            await w.insertBulk(rs)
            assert.strict.strictEqual((await w.select()).length, 450)

            //命中250筆, 超出單一IN清單上限(200)故須分批
            let res = await w.delAll({ value: { $gte: 200 } })
            assert.strict.deepStrictEqual(res, { n: 250, nDeleted: 250, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 200)
        })

        it('含單引號之主鍵可正確刪除', async function() {
            await w.delAll()
            await w.insert([{ id: `it's`, name: `O'Brien`, value: 1 }])
            let res = await w.delAll({ name: `O'Brien` })
            assert.strict.deepStrictEqual(res, { n: 1, nDeleted: 1, ok: 1 })
        })

    })
}
