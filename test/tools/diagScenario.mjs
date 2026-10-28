//診斷輸出測試(R-DIAG)之共用情境: 對一個WOrmMdb實例依序執行各操作(成功與失敗), 回傳各結果與事件payload, 供回傳契約之比對
//同一情境亦於修改前之程式(git HEAD)執行以產生固定預期值(diagGolden.json, 見genDiagGolden.mjs), 故此檔不得依賴R-DIAG之任何新功能
//資料表為users(id, name, value), 見test/assets/worm_def.mdb


let ID = 'u-secret-001@example.com'
let PW = 'S3cretPw'


let settle = async (pm) => {
    try {
        return { ok: await pm }
    }
    catch (err) {
        return { err: String(err && err.message ? err.message : err) }
    }
}


//scenario, withBadListener為true時change與error訂閱函數皆拋錯(觸發診斷輸出之站點)
async function scenario(w, withBadListener) {
    let evs = []
    w.on('change', (m, d, r) => {
        evs.push(['change', m, d, r])
        if (withBadListener) {
            throw new Error(`listener ${ID} ${PW}`)
        }
    })
    w.on('error', (m, d, e) => {
        evs.push(['error', m, d, e])
        if (withBadListener) {
            throw new Error(`listener ${ID} ${PW}`)
        }
    })
    let out = []
    out.push(await settle(w.delAll({})))
    out.push(await settle(w.insert([{ id: 'a1', name: 'n1', value: 1 }, { id: 'a2', name: 'n2', value: 2 }])))
    out.push(await settle(w.insert({ id: 'a1', name: 'dup' })))
    out.push(await settle(w.insertBulk([{ id: 'a1', name: 'dup' }])))
    out.push(await settle(w.save([{ id: 'a1', name: 'n1x' }, { id: 'a3', name: 'n3' }])))
    out.push(await settle(w.select({ id: 'a1' })))
    out.push(await settle(w.select({ name: 'n1x' })))
    out.push(await settle(w.select({ value: { $gt: 0 } })))
    out.push(await settle(w.selectByPk('a2')))
    out.push(await settle(w.select({ $foo: 1 })))
    out.push(await settle(w.del({ id: 'a2' })))
    out.push(await settle(w.delAll({ name: 'n3' })))
    out.push(await settle(w.delAll({})))
    out.push(await settle(w.createStorage()))
    return { out, evs }
}


//scenarioWrongPw, 連線失敗(密碼錯誤之加密檔)時各函數之結果與事件payload
async function scenarioWrongPw(w) {
    let evs = []
    w.on('change', (m, d, r) => {
        evs.push(['change', m, d, r])
    })
    w.on('error', (m, d, e) => {
        evs.push(['error', m, d, e])
    })
    let out = []
    out.push(await settle(w.select({ id: 'a1' })))
    out.push(await settle(w.selectByPk('a1')))
    out.push(await settle(w.insert({ id: 'a1', name: 'n1' })))
    out.push(await settle(w.save({ id: 'a1', name: 'n1' })))
    out.push(await settle(w.del({ id: 'a1' })))
    out.push(await settle(w.delAll({})))
    return { out, evs }
}


//normScenario, 後端(Jet引擎)之錯誤訊息隨系統語系而異(本套件不比對訊息文字, 見CLAUDE.md踩坑紀錄1), 故固定預期值與比對時皆把非本套件訊息(不以[invalid ]起頭者)換成固定字串;
//本套件自產之訊息(invalid find: ...、invalid data: ...等)與其餘各欄位逐字比對
const BACKEND = '<backend error>'
function normMsg(s) {
    return typeof s === 'string' && !s.startsWith('invalid ') ? BACKEND : s
}
function normOut(v) {
    if (Array.isArray(v)) {
        return v.map(normOut)
    }
    if (v !== null && typeof v === 'object') {
        let r = {}
        for (let k of Object.keys(v)) {
            r[k] = k === 'err' ? normMsg(v[k]) : normOut(v[k])
        }
        return r
    }
    return v
}
function normScenario(r) {
    return {
        out: normOut(r.out),
        evs: r.evs.map((e) => (e[0] === 'error' ? [e[0], e[1], e[2], normMsg(e[3])] : e)),
    }
}


export { scenario, scenarioWrongPw, settle, normScenario, ID, PW }
