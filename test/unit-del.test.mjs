import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 del(data)
//[未帶有效主鍵]與[主鍵未命中]須以ok分辨: 前者為輸入問題(ok:0+err), 後者為正常結果(ok:1)


let nm = 'del'
let ss = null

if (isWindows()) {
    describe('WOrmMdb del', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {})
        })

        beforeEach(async function() {
            await w.delAll()
            await w.insert([
                { id: 'a', name: 'A', value: 1 },
                { id: 'b', name: 'B', value: 2 },
                { id: 'c', name: 'C', value: 3 },
            ])
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('主鍵命中並刪除回{n:1,nDeleted:1,ok:1}', async function() {
            let res = await w.del({ id: 'a' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nDeleted: 1, ok: 1 }])
            assert.strict.strictEqual(await w.selectByPk('a'), null)
        })

        it('主鍵未命中回{n:0,nDeleted:0,ok:1}且屬正常結果', async function() {
            let res = await w.del({ id: 'no-such-id' })
            assert.strict.deepStrictEqual(res, [{ n: 0, nDeleted: 0, ok: 1 }])
        })

        it('未帶有效主鍵回ok為0並附err', async function() {
            let res = await w.del({ name: 'no-pk' })
            assert.strict.strictEqual(res.length, 1)
            assert.strict.strictEqual(res[0].n, 0)
            assert.strict.strictEqual(res[0].nDeleted, 0)
            assert.strict.strictEqual(res[0].ok, 0)
            assert.strict.ok(typeof res[0].err === 'string' && res[0].err.length > 0)
        })

        it('主鍵值為各種無效型別皆回ok為0', async function() {
            let res = await w.del([
                { id: '' },
                { id: null },
                { id: undefined },
                { id: {} },
                { id: [] },
                { id: true },
            ])
            assert.strict.deepStrictEqual(res.map((v) => v.ok), [0, 0, 0, 0, 0, 0])
        })

        it('未帶有效主鍵者不得誤刪其他數據', async function() {
            await w.del([{ name: 'no-pk' }, { id: null }])
            assert.strict.strictEqual((await w.select()).length, 3, '不得有任何數據被刪除')
        })

        it('三態於同一批內各自區辨且不互相中斷', async function() {
            let res = await w.del([
                { id: 'a' }, //命中
                { name: 'no-pk' }, //未帶有效主鍵
                { id: 'no-such-id' }, //未命中
                { id: 'b' }, //命中
            ])
            assert.strict.deepStrictEqual(res.map((v) => ({ n: v.n, nDeleted: v.nDeleted, ok: v.ok })), [
                { n: 1, nDeleted: 1, ok: 1 },
                { n: 0, nDeleted: 0, ok: 0 },
                { n: 0, nDeleted: 0, ok: 1 },
                { n: 1, nDeleted: 1, ok: 1 },
            ])
            assert.strict.strictEqual((await w.select()).length, 1, '其餘筆數照常處理')
        })

        it('正常結果不帶err欄位', async function() {
            let res = await w.del([{ id: 'a' }, { id: 'no-such-id' }])
            assert.strict.strictEqual(res[0].err, undefined)
            assert.strict.strictEqual(res[1].err, undefined)
        })

        it('逐筆失敗時整批仍resolve', async function() {
            let rt = await w.del([{ name: 'no-pk' }])
                .then(() => {
                    return 'resolve'
                })
                .catch(() => {
                    return 'reject'
                })
            assert.strict.strictEqual(rt, 'resolve')
        })

        it('回傳陣列恆與輸入等長', async function() {
            let res = await w.del([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
            assert.strict.strictEqual(res.length, 4)
        })

        it('主鍵之命中判定不分大小寫, 與Jet引擎一致', async function() {
            let res = await w.del({ id: 'A' })
            assert.strict.deepStrictEqual(res, [{ n: 1, nDeleted: 1, ok: 1 }])
            assert.strict.strictEqual(await w.selectByPk('a'), null)
        })

        it('重複刪除同一主鍵為冪等', async function() {
            await w.del({ id: 'a' })
            let res = await w.del({ id: 'a' })
            assert.strict.deepStrictEqual(res, [{ n: 0, nDeleted: 0, ok: 1 }])
        })

        it('含單引號之主鍵可正確刪除', async function() {
            await w.insert([{ id: `it's`, name: 'Q', value: 1 }])
            let res = await w.del({ id: `it's` })
            assert.strict.deepStrictEqual(res, [{ n: 1, nDeleted: 1, ok: 1 }])
        })

    })
}
