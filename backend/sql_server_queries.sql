-- ============================================================================
-- SCRIPT DE BASE DE DATOS Y CONSULTAS PARA MICROSOFT SQL SERVER (SSMS)
-- ============================================================================
-- Este script permite replicar la estructura de la base de datos de exámenes
-- e incluye consultas útiles de ejemplo para ejecutar en SSMS.

-- 1. CREACIÓN DE TABLAS
-- ==========================================

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

-- 2. CONSULTAS DE DATOS DE EJEMPLO (SQL SERVER)
-- ==========================================

-- Consulta A: Obtener todos los exámenes con el nombre de su grupo y porcentaje de aciertos
SELECT 
    e.id AS ExamenID,
    e.topic AS Tema,
    e.date AS FechaISO,
    e.correct_count AS RespuestasCorrectas,
    e.total_questions AS TotalPreguntas,
    ROUND((CAST(e.correct_count AS FLOAT) / CAST(e.total_questions AS FLOAT)) * 100, 2) AS PorcentajeAcierto,
    CASE WHEN e.passed = 1 THEN 'APROBADO' ELSE 'REPROBADO' END AS Estado,
    ISNULL(g.name, 'Sin grupo') AS NombreGrupo
FROM exams e
LEFT JOIN groups g ON e.group_id = g.id
ORDER BY e.date DESC;
GO

-- Consulta B: Consultar e interpretar datos almacenados en formato JSON (Exclusivo de SQL Server 2016+)
-- Extrae la primera pregunta y explicación de cada examen
SELECT 
    id AS ExamenID,
    topic AS Tema,
    JSON_VALUE(questions, '$[0].question') AS PrimeraPregunta,
    JSON_VALUE(questions, '$[0].explanation') AS ExplicacionPrimeraPregunta
FROM exams
WHERE ISJSON(questions) > 0;
GO

-- Consulta C: Estadísticas y métricas de rendimiento por Tema
SELECT 
    topic AS Tema,
    COUNT(*) AS ExamenesRealizados,
    SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS TotalAprobados,
    SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) AS TotalReprobados,
    AVG(correct_count) AS PromedioCorrectas,
    ROUND(AVG((CAST(correct_count AS FLOAT) / CAST(total_questions AS FLOAT)) * 100), 2) AS PorcentajePromedioAcierto
FROM exams
GROUP BY topic;
GO

-- Consulta D: Desglosar todas las preguntas de un examen específico en filas individuales
-- (Reemplazar 'UUID-AQUI' por un ID real)
/*
SELECT 
    e.topic AS Tema,
    q.[key] AS NumeroPregunta,
    JSON_VALUE(q.value, '$.question') AS Pregunta,
    JSON_VALUE(q.value, '$.explanation') AS Explicacion
FROM exams e
CROSS APPLY OPENJSON(e.questions) q
WHERE e.id = 'UUID-AQUI';
*/
GO
