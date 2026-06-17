const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')
const bcrypt = require('bcryptjs')

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'operator', 'viewer'), defaultValue: 'viewer' },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
})

User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10)
})

User.prototype.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.password)
}

module.exports = User
