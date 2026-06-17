const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const PowerEvent = sequelize.define('PowerEvent', {
  id:                    { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  deviceId:              { type: DataTypes.INTEGER, allowNull: false },
  shutdownId:            { type: DataTypes.STRING, allowNull: false },
  state:                 { type: DataTypes.ENUM('active', 'cancelled', 'completed'), defaultValue: 'active' },
  startedAt:             { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  resolvedAt:            { type: DataTypes.DATE, allowNull: true },
  previousHaPolicy:      { type: DataTypes.STRING, allowNull: true },
  haPreparedMachineKeys: { type: DataTypes.JSON, defaultValue: [] },
})

module.exports = PowerEvent
