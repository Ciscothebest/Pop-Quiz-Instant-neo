-- ============================================================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS PARA MICROSOFT SQL SERVER (SSMS)
-- ============================================================================

-- 1. CREACIÓN DE LA BASE DE DATOS
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'ExamenesIaDb')
BEGIN
    CREATE DATABASE ExamenesIaDb;
    PRINT 'Base de datos [ExamenesIaDb] creada con éxito.';
END
ELSE
BEGIN
    PRINT 'La base de datos [ExamenesIaDb] ya existe.';
END;
GO

USE ExamenesIaDb;
GO

-- 2. CREACIÓN DE TABLAS

-- Crear tabla de grupos (Groups)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'groups')
BEGIN
    CREATE TABLE groups (
        id VARCHAR(50) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL
    );
    PRINT 'Tabla [groups] creada con éxito.';
END
ELSE
BEGIN
    PRINT 'La tabla [groups] ya existe.';
END;

-- Crear tabla de exámenes (Exams)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'exams')
BEGIN
    CREATE TABLE exams (
        id VARCHAR(50) PRIMARY KEY,
        topic NVARCHAR(200) NOT NULL,
        date VARCHAR(50) NOT NULL, -- Almacena fecha en formato ISO
        questions NVARCHAR(MAX) NOT NULL, -- Formato JSON de preguntas
        answers NVARCHAR(MAX) NOT NULL,   -- Formato JSON de respuestas seleccionadas
        correct_count INT NOT NULL,
        total_questions INT NOT NULL,
        passed INT NOT NULL, -- 1 = Aprobado, 0 = Reprobado
        group_id VARCHAR(50) NULL,
        difficulty VARCHAR(50) NOT NULL DEFAULT 'normal',
        CONSTRAINT FK_exams_groups FOREIGN KEY (group_id) 
            REFERENCES groups(id) ON DELETE SET NULL
    );
    PRINT 'Tabla [exams] creada con éxito.';
END
ELSE
BEGIN
    PRINT 'La tabla [exams] ya existe.';
END;
GO
