/**
 * 於指定時區執行函數, 無論成敗皆還原為呼叫前之時區(可巢狀)
 *
 * 註: mocha --parallel之同一worker會續跑其他測試檔, 時區若未還原會污染其後測試, 故還原置於finally
 * 註: 命令列環境變數TZ=在Windows僅UTC有效, 須於程序內賦值process.env.TZ(Node賦值時會通知V8重載時區);
 * 還原須賦回呼叫前之時區名稱(取自Intl, 反映V8當前時區), delete process.env.TZ不會令V8重載(仍停在上一個時區, 實測)
 *
 * @param {String} tz 輸入IANA時區名稱字串
 * @param {Function} fn 輸入函數, 可為async
 * @returns {Promise} 回傳fn之結果
 */
async function withTz(tz, fn) {
    let prev = Intl.DateTimeFormat().resolvedOptions().timeZone
    process.env.TZ = tz
    //時區名稱打錯時V8靜默落到Etc/Unknown(偏移0), 使該時區之案例以UTC行為全綠而不自知, 故於此擋下
    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Etc/Unknown') {
        process.env.TZ = prev
        throw new Error(`unknown time zone: ${tz}`)
    }
    try {
        return await fn()
    }
    finally {
        process.env.TZ = prev
    }
}


export default withTz
