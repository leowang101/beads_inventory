# Migrations

此目录用于存放**手动执行**的 SQL 迁移或索引调整脚本。

执行示例：

```bash
mysql -u <user> -p -h <host> <db_name> < migrations/xxx.sql
```

回滚示例：

```sql
DROP INDEX idx_name ON table_name;
```
