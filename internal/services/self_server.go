package services

import (
	"self_server/internal/config"
	"self_server/internal/server"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type SelfServerService struct {
	App           *application.App
	Config        *config.Config
	ServerManager *server.Manager
}

func (s *SelfServerService) AppReady() {
	go func() {
		s.App.Event.Emit("update:projects", s.Config.Projects)
	}()
}

func (s *SelfServerService) AddProject(name string) error {
	s.Config.Projects = append(s.Config.Projects, config.ProjectConfig{Name: name})
	return config.SaveConfig(s.Config)
}

func (s *SelfServerService) RemoveProject(name string) error {
	for _, project := range s.Config.Projects {
		if project.Name == name {
			for _, srv := range project.Servers {
				s.ServerManager.Stop(srv.Port)
			}
			break
		}
	}
	updated := s.Config.Projects[:0]
	for _, project := range s.Config.Projects {
		if project.Name != name {
			updated = append(updated, project)
		}
	}
	s.Config.Projects = updated
	return config.SaveConfig(s.Config)
}
