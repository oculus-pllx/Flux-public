const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const Metrics = sequelize.define('Metrics', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  deviceId: { type: DataTypes.INTEGER, allowNull: false },
  data: { type: DataTypes.JSON, allowNull: false },
  recordedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
})

module.exports = Metrics
