//SQL紀錄之敘述種類(R-DIAG, 診斷輸出之safe摘要): 自舊src/getDiag.mjs移出(診斷出口與遮罩改用wsemi之getDiag, 見dspec〈診斷輸出與遮罩〉)


//SQL敘述種類白名單(sequelize於記憶體sqlite產生之敘述首字), 其餘一律OTHER
const STMTS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'WITH']


function getSqlStmt(sql) {
    //SQL紀錄的敘述種類(白名單首字, 去除sequelize加上之Executing (連線代號): 前綴), 不含表名與值; 其餘為OTHER
    if (typeof sql !== 'string') {
        return 'OTHER'
    }
    let m = sql.replace(/^\s*Executing \([^)]*\):\s*/i, '').match(/^\s*([A-Za-z]+)/)
    let w = m === null ? '' : m[1].toUpperCase()
    return STMTS.indexOf(w) >= 0 ? w : 'OTHER'
}


export { STMTS }
export default getSqlStmt
