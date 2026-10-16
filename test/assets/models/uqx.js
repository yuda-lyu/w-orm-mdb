/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('uqx', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'code': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'name': {
type: DataTypes.TEXT,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'uqx'
});
};
