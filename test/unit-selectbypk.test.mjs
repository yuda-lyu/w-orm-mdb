import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 selectByPk(pk)
//命中回數據物件、未命中回null、主鍵值無效回null且不reject
//命中之判定基準須與insert、save、del內對既有數據之認定一致


let nm = 'selectbypk'
let ss = null

if (isWindows()) {
    describe('WOrmMdb selectByPk', function() {

        let w = null

        before(async function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {})
            await w.delAll()
            await w.insert([
                { id: 'id-peter', name: 'peter', value: 123 },
                { id: 'id-rosemary', name: 'rosemary', value: 123.456 },
            ])
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('主鍵命中回傳該筆數據物件', async function() {
            let r = await w.selectByPk('id-peter')
            assert.strict.deepStrictEqual(r, { id: 'id-peter', name: 'peter', value: 123 })
        })

        it('內容與select({主鍵})[0]相同', async function() {
            let a = await w.selectByPk('id-rosemary')
            let b = (await w.select({ id: 'id-rosemary' }))[0]
            assert.strict.deepStrictEqual(a, b)
        })

        it('主鍵未命中回null', async function() {
            assert.strict.strictEqual(await w.selectByPk('no-such-id'), null)
        })

        it('主鍵值無效回null且不reject', async function() {
            assert.strict.strictEqual(await w.selectByPk(''), null)
            assert.strict.strictEqual(await w.selectByPk(null), null)
            assert.strict.strictEqual(await w.selectByPk(undefined), null)
            assert.strict.strictEqual(await w.selectByPk({}), null)
            assert.strict.strictEqual(await w.selectByPk([]), null)
            assert.strict.strictEqual(await w.selectByPk(true), null)
        })

        it('主鍵值無效時不得誤中其他數據', async function() {
            //無效主鍵值若被送進查詢條件, 部分後端會轉為null而誤中其他資料
            let rs = await w.select()
            assert.strict.strictEqual(rs.length, 2, '前置數據應為2筆')
            assert.strict.strictEqual(await w.selectByPk(null), null)
        })

        it('命中判定與insert一致: selectByPk回物件者insert須視為已存在', async function() {
            //Jet之字串比對不分大小寫, 故兩者對[命中]之認定亦須一致
            let r = await w.selectByPk('ID-PETER')
            assert.strict.ok(r !== null, 'selectByPk須命中')
            let res = await w.insert([{ id: 'ID-PETER', name: 'should-skip' }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 0, ok: 1 })
            let after = await w.selectByPk('id-peter')
            assert.strict.strictEqual(after.name, 'peter', '既有數據不得被覆寫')
        })

        it('命中判定與del一致', async function() {
            await w.insert([{ id: 'dd-1', name: 'D', value: 1 }])
            assert.strict.ok(await w.selectByPk('DD-1') !== null)
            let res = await w.del([{ id: 'DD-1' }])
            assert.strict.deepStrictEqual(res, [{ n: 1, nDeleted: 1, ok: 1 }])
            assert.strict.strictEqual(await w.selectByPk('dd-1'), null)
        })

        it('不得有副作用: 查詢後數據筆數不變', async function() {
            let n0 = (await w.select()).length
            await w.selectByPk('no-such-id')
            await w.selectByPk('id-peter')
            await w.selectByPk('')
            let n1 = (await w.select()).length
            assert.strict.strictEqual(n1, n0)
        })

    })
}
