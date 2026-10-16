/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tk', {
'k': {
type: DataTypes.INTEGER,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'id': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
'v': {
type: DataTypes.DOUBLE,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tk'
});
};
