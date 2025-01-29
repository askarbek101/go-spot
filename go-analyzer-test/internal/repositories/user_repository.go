package repositories

import (
	"database/sql"
	"go-analyzer-test/internal/interfaces"
)

type UserPostgresRepository struct {
	db *sql.DB
}

func NewUserPostgresRepository(db *sql.DB) interfaces.Repository {
	return &UserPostgresRepository{db: db}
}

func (r *UserPostgresRepository) Create(entity interface{}) error {
	return nil
}

func (r *UserPostgresRepository) Update(id string, entity interface{}) error {
	return nil
}

func (r *UserPostgresRepository) Delete(id string) error {
	return nil
}

func (r *UserPostgresRepository) FindById(id string) (interface{}, error) {
	return nil, nil
}

func (r *UserPostgresRepository) FindAll() ([]interface{}, error) {
	return nil, nil
}
