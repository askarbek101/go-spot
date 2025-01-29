package interfaces

type Repository interface {
	Create(entity interface{}) error
	Update(id string, entity interface{}) error
	Delete(id string) error
	FindById(id string) (interface{}, error)
	FindAll() ([]interface{}, error)
}
