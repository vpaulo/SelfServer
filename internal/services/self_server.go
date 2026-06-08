package services

type SelfServerService struct{}

func (g *SelfServerService) Greet(name string) string {
	return "Hello " + name + "!"
}
