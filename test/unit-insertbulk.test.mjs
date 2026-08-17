import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt, getRt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 insertBulk(data)
//全批視為一個單位: 全部插入成功, 或一筆都不寫入
//本函數非insert之加速版, 兩者衝突政策不同


let nm = 'insertbulk'
let ss = null

if (isWindows()) {
    describe('WOrmMdb insertBulk', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {})
        })

        beforeEach(async function() {
            await w.delAll()
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('無衝突時nInserted恆等於n', async function() {
            let res = await w.insertBulk([
                { id: 'a', name: 'A', value: 1 },
                { id: 'b', name: 'B', value: 2 },
                { id: 'c', name: 'C', value: 3 },
            ])
            assert.strict.deepStrictEqual(res, { n: 3, nInserted: 3, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 3)
        })

        it('收單一物件亦正常處理', async function() {
            let res = await w.insertBulk({ id: 'a', name: 'A', value: 1 })
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })
        })

        it('撞既有主鍵時整批reject', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            let rt = await getRt(w.insertBulk([
                { id: 'b', name: 'B', value: 2 },
                { id: 'a', name: 'A-new', value: 9 },
            ]))
            assert.strict.strictEqual(rt, 'reject')
        })

        it('撞既有主鍵失敗後資料表無任何新增', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            await getRt(w.insertBulk([
                { id: 'b', name: 'B', value: 2 },
                { id: 'c', name: 'C', value: 3 },
                { id: 'a', name: 'A-new', value: 9 },
            ]))
            let rs = await w.select()
            assert.strict.strictEqual(rs.length, 1, '筆數增量須為0')
            assert.strict.strictEqual(await w.selectByPk('b'), null)
            assert.strict.strictEqual(await w.selectByPk('c'), null)
        })

        it('撞既有主鍵失敗後既有數據未被改動', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            await getRt(w.insertBulk([{ id: 'a', name: 'A-new', value: 9 }]))
            assert.strict.deepStrictEqual(await w.selectByPk('a'), { id: 'a', name: 'A', value: 1 })
        })

        it('同批含重複主鍵時整批reject', async function() {
            let rt = await getRt(w.insertBulk([
                { id: 's', name: 'S1', value: 1 },
                { id: 's', name: 'S2', value: 2 },
            ]))
            assert.strict.strictEqual(rt, 'reject')
        })

        it('同批重複主鍵失敗後資料表無任何新增', async function() {
            await getRt(w.insertBulk([
                { id: 't1', name: 'T1', value: 1 },
                { id: 't2', name: 'T2', value: 2 },
                { id: 't1', name: 'T1-dup', value: 3 },
            ]))
            assert.strict.deepStrictEqual(await w.select(), [])
        })

        it('大批次末筆衝突時全數回滾', async function() {
            //寫入若被拆為多次送出, 前段可能已落盤; 本套件以Jet之交易包覆故失敗即回滾
            await w.insert([{ id: 'zz', name: 'ZZ', value: 0 }])
            let rs = []
            for (let i = 0; i < 200; i++) {
                rs.push({ id: `k${i}`, name: `N${i}`, value: i })
            }
            rs.push({ id: 'zz', name: 'conflict', value: 9 })
            let rt = await getRt(w.insertBulk(rs))
            assert.strict.strictEqual(rt, 'reject')
            let after = await w.select()
            assert.strict.strictEqual(after.length, 1, '筆數增量須為0')
            assert.strict.strictEqual(after[0].name, 'ZZ', '既有數據不得被改動')
        })

        it('非別名或轉呼叫insert: 同一情境下兩者行為分歧', async function() {
            //確無衝突時兩者之可觀察結果完全相同, 差異僅於有衝突時顯現
            await w.insert([{ id: 'a', name: 'A', value: 1 }])

            let resIns = await w.insert([{ id: 'a', name: 'X' }, { id: 'b', name: 'B', value: 2 }])
            assert.strict.deepStrictEqual(resIns, { n: 2, nInserted: 1, ok: 1 }, 'insert須跳過已存在者')

            await w.delAll()
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            let rt = await getRt(w.insertBulk([{ id: 'a', name: 'X' }, { id: 'b', name: 'B', value: 2 }]))
            assert.strict.strictEqual(rt, 'reject', 'insertBulk須整批reject')
            assert.strict.strictEqual(await w.selectByPk('b'), null)
        })

        it('無衝突時與insert之可觀察結果相同', async function() {
            let a = await w.insertBulk([{ id: 'a', name: 'A', value: 1 }])
            await w.delAll()
            let b = await w.insert([{ id: 'a', name: 'A', value: 1 }])
            assert.strict.deepStrictEqual(a, b)
        })

    })
}
