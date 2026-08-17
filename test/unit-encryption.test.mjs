import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt, getRt } from './unit-setup.mjs'


//spec: 加密檔之密碼組成為`${username}:${password}`(worm_encryption_def.mdb為username:password)
//加密檔之各函數行為須與一般檔完全相同


let nm = 'encryption'
let ss = null

if (isWindows()) {
    describe('WOrmMdb encryption', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm, { useEncryption: true })
            w = wo(mkOpt(ss.fpStorage, {
                url: 'mdb://username:password',
                useEncryption: true,
            }))
            w.on('error', function() {}) //錯誤斷言於回傳值, 不需console
        })

        beforeEach(async function() {
            await w.delAll()
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('加密檔insert與select中文數據正確', async function() {
            let res = await w.insert([{ id: 'id-enc', name: '加密檔中文寫入', value: 456.789 }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })
            let rs = await w.select({ id: 'id-enc' })
            assert.strict.deepStrictEqual(rs, [{ id: 'id-enc', name: '加密檔中文寫入', value: 456.789 }])
        })

        it('加密檔selectByPk正確', async function() {
            await w.insert([{ id: 'id-enc', name: '加密檔中文寫入', value: 456.789 }])
            assert.strict.deepStrictEqual(await w.selectByPk('id-enc'), { id: 'id-enc', name: '加密檔中文寫入', value: 456.789 })
            assert.strict.strictEqual(await w.selectByPk('no-such-id'), null)
        })

        it('加密檔insert已存在則跳過', async function() {
            await w.insert([{ id: 'id-enc', name: '原值', value: 1 }])
            let res = await w.insert([{ id: 'id-enc', name: '新值', value: 2 }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 0, ok: 1 })
            assert.strict.strictEqual((await w.selectByPk('id-enc')).name, '原值')
        })

        it('加密檔insertBulk衝突時整批回滾', async function() {
            await w.insert([{ id: 'e1', name: 'E1', value: 1 }])
            let rt = await getRt(w.insertBulk([{ id: 'e2', name: 'E2', value: 2 }, { id: 'e1', name: 'X' }]))
            assert.strict.strictEqual(rt, 'reject')
            assert.strict.strictEqual(await w.selectByPk('e2'), null, '失敗後須無任何新增')
        })

        it('加密檔save修改數據', async function() {
            await w.insert([{ id: 'id-enc', name: '原值', value: 1 }])
            let res = await w.save([{ id: 'id-enc', name: '更新後的中文' }], { autoInsert: false })
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.strict.strictEqual((await w.selectByPk('id-enc')).name, '更新後的中文')
        })

        it('加密檔save合併後內容相同則不寫入', async function() {
            await w.insert([{ id: 'id-enc', name: '原值', value: 1 }])
            let res = await w.save([{ id: 'id-enc', name: '原值' }])
            assert.strict.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
        })

        it('加密檔del與delAll', async function() {
            await w.insert([
                { id: 'e1', name: 'E1', value: 1 },
                { id: 'e2', name: 'E2', value: 2 },
            ])
            assert.strict.deepStrictEqual(await w.del({ id: 'e1' }), [{ n: 1, nDeleted: 1, ok: 1 }])
            assert.strict.deepStrictEqual(await w.delAll(), { n: 1, nDeleted: 1, ok: 1 })
            assert.strict.deepStrictEqual(await w.select(), [])
        })

        it('錯誤密碼開啟加密檔被拒', async function() {
            let wBad = wo(mkOpt(ss.fpStorage, {
                url: 'mdb://username:wrongpwd',
                useEncryption: true,
            }))
            wBad.on('error', function() {})
            let err = null
            await wBad.select()
                .catch((e) => {
                    err = e
                })
            assert.strict.ok(err !== null, '應被拒絕')
            assert.strict.ok(String(err).indexOf('Not a valid password') >= 0, `錯誤訊息應含Not a valid password, 實得: ${err}`)
        })

        it('useEncryption為true而url缺username或password時建構即拋出', async function() {
            assert.strict.throws(function() {
                wo(mkOpt(ss.fpStorage, { url: 'mdb://:password', useEncryption: true }))
            })
            assert.strict.throws(function() {
                wo(mkOpt(ss.fpStorage, { url: 'mdb://username:', useEncryption: true }))
            })
        })

    })
}
